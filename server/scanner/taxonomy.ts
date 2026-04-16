/**
 * Skill Taxonomy — automatic classification engine.
 *
 * Assigns every skill a category based on:
 *   1. Explicit `category` in frontmatter (highest priority)
 *   2. Keyword matching against name + description using the shared NLP
 *      tokenizer and synonym index
 *
 * Also produces merge suggestions when multiple skills within the same
 * category are semantically similar (Jaccard > 0.3).
 */
import type { Skill } from '../types.js'
import {
  BUILTIN_SYNONYMS,
  buildSynonymIndex,
  tokenize,
  jaccard,
} from './nlp.js'

// ---------------------------------------------------------------------------
// Category definitions
// ---------------------------------------------------------------------------

export interface CategoryDef {
  id: string
  name: string
  icon: string
  /** Matching keywords — run through the synonym index before comparison. */
  keywords: string[]
  /** Higher priority wins when multiple categories match equally. */
  priority: number
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'code-dev',
    name: '代码开发',
    icon: '💻',
    keywords: [
      'tdd', 'frontend', 'backend', 'api', 'debug', 'refactor', 'lint',
      'ci', 'git', 'commit', 'pull-request', 'review', 'typescript',
      'python', 'rust', 'golang', 'java', 'react', 'vue', 'next',
      'webpack', 'vite', 'npm', 'pnpm', 'bun', 'deno',
    ],
    priority: 5,
  },
  {
    id: 'content',
    name: '内容创作',
    icon: '✍️',
    keywords: [
      'write', 'article', 'blog', 'copywriting', 'seo', 'newsletter',
      '文章', '写作', '创作', '选题', '大纲', '稿件', 'essay',
    ],
    priority: 5,
  },
  {
    id: 'image-gen',
    name: '图片生成',
    icon: '🎨',
    keywords: [
      'image', 'picture', 'photo', 'cover', 'banner', 'illustration',
      '封面', '配图', '插画', 'dalle', 'midjourney', 'flux',
      'stable-diffusion', 'comfyui', 'logo',
    ],
    priority: 6,
  },
  {
    id: 'video-audio',
    name: '视频/音频',
    icon: '🎬',
    keywords: [
      'video', 'audio', 'ffmpeg', 'remotion', 'mp4', 'podcast',
      'subtitle', 'srt', 'tts', 'voice', '视频', '音频', '字幕',
    ],
    priority: 5,
  },
  {
    id: 'data',
    name: '数据分析',
    icon: '📊',
    keywords: [
      'data', 'analytics', 'chart', 'csv', 'excel', 'dashboard',
      'visualization', 'stats', 'metrics', 'sql', 'database',
      '报告', '报表', '统计',
    ],
    priority: 5,
  },
  {
    id: 'web-search',
    name: '网络搜索',
    icon: '🔍',
    keywords: [
      'search', 'web', 'browse', 'scrape', 'crawl', 'spider',
      '搜索', '抓取', '爬虫', 'google', 'bing', 'perplexity',
    ],
    priority: 6,
  },
  {
    id: 'social',
    name: '社交媒体',
    icon: '📱',
    keywords: [
      '小红书', 'xhs', 'twitter', 'weibo', '公众号', 'wechat',
      'instagram', 'tiktok', '抖音', '微博', 'linkedin', 'threads',
      'youtube', 'bilibili', 'x.com',
    ],
    priority: 7,
  },
  {
    id: 'doc',
    name: '文档处理',
    icon: '📄',
    keywords: [
      'pdf', 'docx', 'pptx', 'xlsx', 'notion', 'confluence',
      '文档', 'readme', 'spec', 'rfc', 'wiki',
    ],
    priority: 5,
  },
  {
    id: 'comms',
    name: '通讯协作',
    icon: '💬',
    keywords: [
      'email', 'mail', 'slack', 'feishu', 'lark', 'dingtalk',
      'telegram', 'discord', '飞书', '邮件', '钉钉', 'teams',
    ],
    priority: 5,
  },
  {
    id: 'design',
    name: '设计/UI',
    icon: '🖌️',
    keywords: [
      'figma', 'ui', 'ux', 'canvas', 'theme', 'brand', 'sketch',
      'wireframe', 'prototype', 'tailwind', 'css', '设计',
    ],
    priority: 5,
  },
  {
    id: 'translate',
    name: '翻译/i18n',
    icon: '🌐',
    keywords: [
      'translate', 'translation', 'i18n', 'l10n', 'locale',
      '翻译', '多语言', '本地化',
    ],
    priority: 6,
  },
  {
    id: 'sysadmin',
    name: '系统管理',
    icon: '🖥️',
    keywords: [
      'server', 'docker', 'k8s', 'kubernetes', 'devops', 'ssh',
      'linux', 'nginx', 'infra', 'terraform', 'aws', 'gcp', 'azure',
      '运维', '部署', 'monitor',
    ],
    priority: 5,
  },
  {
    id: 'persona',
    name: '人格/角色',
    icon: '🎭',
    keywords: [
      'personality', 'persona', 'mbti', 'sbti', 'character', 'role',
      '人格', '角色', '蒸馏', 'roleplay', 'assistant',
    ],
    priority: 6,
  },
  {
    id: 'finance',
    name: '财务/金融',
    icon: '💰',
    keywords: [
      'finance', 'invoice', 'receipt', 'stock', 'trade', 'accounting',
      '发票', '财务', '金融', '投资', '报销', 'budget',
    ],
    priority: 5,
  },
  // Catch-all — MUST be last. Empty keywords means it never wins via matching.
  {
    id: 'other',
    name: '其他',
    icon: '📦',
    keywords: [],
    priority: 0,
  },
]

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]))

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

/**
 * Build a token set for each category's keywords (through the synonym index).
 */
function buildCategoryTokens(
  synonymIndex: Map<string, string>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const cat of CATEGORIES) {
    if (cat.keywords.length === 0) {
      out.set(cat.id, new Set())
      continue
    }
    out.set(cat.id, tokenize(cat.keywords.join(' '), synonymIndex))
  }
  return out
}

/**
 * Classify a single skill. Returns a category id.
 */
export function classifySkill(
  skill: Skill,
  synonymIndex: Map<string, string>,
  categoryTokens: Map<string, Set<string>>,
): string {
  // 1. Frontmatter override — if the user explicitly set `category`
  const fmCat = (skill.frontmatter as any)?.category
  if (typeof fmCat === 'string' && fmCat.trim()) {
    const normalized = fmCat.trim().toLowerCase()
    if (CATEGORY_BY_ID.has(normalized)) return normalized
    // Try matching by name
    for (const cat of CATEGORIES) {
      if (cat.name === fmCat.trim()) return cat.id
    }
  }

  // 2. Keyword matching: tokenize skill's name + description, compute overlap
  //    with each category's keyword token set.
  const skillText = [skill.name, skill.description].filter(Boolean).join(' ')
  const skillTokens = tokenize(skillText, synonymIndex)
  if (skillTokens.size === 0) return 'other'

  let bestId = 'other'
  let bestScore = 0
  let bestPriority = 0

  for (const cat of CATEGORIES) {
    if (cat.keywords.length === 0) continue
    const catTokens = categoryTokens.get(cat.id)
    if (!catTokens || catTokens.size === 0) continue

    // Count how many of the skill's tokens appear in the category
    let overlap = 0
    for (const t of skillTokens) {
      if (catTokens.has(t)) overlap++
    }
    if (overlap === 0) continue

    // Score = overlap count normalized by skill token count (recall-oriented).
    // We want "what fraction of the skill's identity matches this category".
    const score = overlap / skillTokens.size

    if (
      score > bestScore ||
      (score === bestScore && cat.priority > bestPriority)
    ) {
      bestScore = score
      bestPriority = cat.priority
      bestId = cat.id
    }
  }

  return bestId
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CategorySummary {
  id: string
  name: string
  icon: string
  count: number
  skillIds: string[]
}

export interface MergeSuggestion {
  category: string
  categoryName: string
  reason: string
  skills: { id: string; name: string }[]
  similarity: number
}

export interface ClassifyResult {
  /** Skills with `.category` populated */
  skills: Skill[]
  /** Per-category aggregation */
  categories: CategorySummary[]
  /** Merge suggestions for same-category high-similarity skills */
  mergeSuggestions: MergeSuggestion[]
  /** Count by category id */
  byCategory: Record<string, number>
}

/**
 * Classify all skills, produce category summaries and merge suggestions.
 */
export function classifyAll(skills: Skill[]): ClassifyResult {
  const synonymIndex = buildSynonymIndex(BUILTIN_SYNONYMS)
  const categoryTokens = buildCategoryTokens(synonymIndex)

  // 1. Assign categories
  for (const skill of skills) {
    ;(skill as any).category = classifySkill(skill, synonymIndex, categoryTokens)
  }

  // 2. Build category summaries
  const catMap = new Map<string, string[]>() // category id → skill ids
  for (const skill of skills) {
    const catId = (skill as any).category as string
    const arr = catMap.get(catId) || []
    arr.push(skill.id)
    catMap.set(catId, arr)
  }

  const categories: CategorySummary[] = []
  const byCategory: Record<string, number> = {}
  for (const cat of CATEGORIES) {
    const ids = catMap.get(cat.id) || []
    if (ids.length === 0) continue
    categories.push({
      id: cat.id,
      name: cat.name,
      icon: cat.icon,
      count: ids.length,
      skillIds: ids,
    })
    byCategory[cat.id] = ids.length
  }

  // 3. Merge suggestions: within each category, find pairs with Jaccard > 0.3
  const mergeSuggestions: MergeSuggestion[] = []
  const skillById = new Map(skills.map((s) => [s.id, s]))

  for (const cat of categories) {
    if (cat.count < 2) continue
    const catSkills = cat.skillIds
      .map((id) => skillById.get(id))
      .filter((s): s is Skill => !!s)

    // Tokenize each skill in this category
    const sigs = new Map<string, Set<string>>()
    for (const s of catSkills) {
      const text = [s.name, s.description].filter(Boolean).join(' ')
      sigs.set(s.id, tokenize(text, synonymIndex))
    }

    // Find high-similarity pairs
    for (let i = 0; i < catSkills.length; i++) {
      for (let j = i + 1; j < catSkills.length; j++) {
        const a = catSkills[i]
        const b = catSkills[j]
        if (a.name === b.name) continue // conflicts, not merge candidates
        const score = jaccard(sigs.get(a.id)!, sigs.get(b.id)!)
        if (score >= 0.3) {
          mergeSuggestions.push({
            category: cat.id,
            categoryName: cat.name,
            reason: `同属「${cat.name}」，语义相似度 ${Math.round(score * 100)}%，建议合并为一个包含子场景的 Skill`,
            skills: [
              { id: a.id, name: a.name },
              { id: b.id, name: b.name },
            ],
            similarity: Math.round(score * 100) / 100,
          })
        }
      }
    }
  }

  // Sort merge suggestions by similarity descending
  mergeSuggestions.sort((a, b) => b.similarity - a.similarity)

  return { skills, categories, mergeSuggestions, byCategory }
}
