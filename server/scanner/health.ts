/**
 * Skill Health Diagnostics
 *
 * Based on research from "When Single-Agent with Skills Replace Multi-Agent
 * Systems and When They Fail" (Xiaoxiao Li, UBC, arXiv:2601.04748):
 *
 *   - ≤ 20 skills: ~90%+ accuracy (green)
 *   - 21-50 skills: 70-90% accuracy (yellow)
 *   - > 50 skills: accuracy drops steeply (red)
 *
 * Semantic confusability is more damaging than raw quantity:
 *   - 1 semantic competitor per skill: -7-30% accuracy
 *   - 2 competitors: -17-63% accuracy
 *
 * Hierarchical routing recovers +37-40% absolute at 120 skills.
 */
import type { Skill, ConflictGroup } from '../types.js'
import type { SimilarityGroup } from './similarity.js'
import type { CategorySummary, MergeSuggestion } from './taxonomy.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthLevel = 'green' | 'yellow' | 'red'
export type DiagnosticSeverity = 'info' | 'warn' | 'danger'

export interface Diagnostic {
  type:
    | 'quantity'
    | 'semantic_clash'
    | 'missing_description'
    | 'oversized_content'
    | 'scope_suggestion'
    | 'duplicate_content'
    | 'low_quality_trigger'
  severity: DiagnosticSeverity
  title: string
  detail: string
  affectedSkillIds: string[]
}

export interface HealthReport {
  level: HealthLevel
  score: number       // 0-100
  summary: string
  diagnostics: Diagnostic[]
}

// ---------------------------------------------------------------------------
// Thresholds (from the paper)
// ---------------------------------------------------------------------------

const GREEN_MAX = 20
const YELLOW_MAX = 50
// >50 → red

const CONTENT_LINE_LIMIT = 500 // Anthropic recommended max for SKILL.md

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export function computeHealth(
  skills: Skill[],
  conflicts: ConflictGroup[],
  similarGroups: SimilarityGroup[],
  _categories: CategorySummary[],
  mergeSuggestions: MergeSuggestion[],
): HealthReport {
  const diagnostics: Diagnostic[] = []
  const total = skills.length

  // ---- 1. Quantity diagnostic ----
  if (total > YELLOW_MAX) {
    diagnostics.push({
      type: 'quantity',
      severity: 'danger',
      title: `Skill 总量过多 (${total} 个)`,
      detail: `研究表明超过 50 个 Skill 后触发准确率急剧下降。当前 ${total} 个，建议精简到 30 以下。`,
      affectedSkillIds: [],
    })
  } else if (total > GREEN_MAX) {
    diagnostics.push({
      type: 'quantity',
      severity: 'warn',
      title: `Skill 数量偏多 (${total} 个)`,
      detail: `当前 ${total} 个 Skill，触发准确率约 ${estimateAccuracy(total)}%。精简到 20 以下可保持 90%+ 准确率。`,
      affectedSkillIds: [],
    })
  }

  // ---- 2. Semantic clashes (high-similarity groups) ----
  const highClashGroups = similarGroups.filter((g) => g.averageSimilarity >= 0.4)
  for (const group of highClashGroups) {
    diagnostics.push({
      type: 'semantic_clash',
      severity: 'danger',
      title: `语义冲突：${group.skills.map((s) => s.name).join(' vs ')}`,
      detail: `这 ${group.skills.length} 个 Skill 相似度 ${Math.round(group.averageSimilarity * 100)}%，极可能互相"抢触发"。建议合并或删除冗余项。`,
      affectedSkillIds: group.skills.map((s) => s.id),
    })
  }
  // Medium clashes
  const medClashGroups = similarGroups.filter(
    (g) => g.averageSimilarity >= 0.25 && g.averageSimilarity < 0.4,
  )
  if (medClashGroups.length > 0) {
    const allIds = medClashGroups.flatMap((g) => g.skills.map((s) => s.id))
    diagnostics.push({
      type: 'semantic_clash',
      severity: 'warn',
      title: `${medClashGroups.length} 组 Skill 存在语义重叠`,
      detail: `有 ${medClashGroups.length} 组 Skill 语义相似度在 25%-40% 之间，可能导致误触发。建议在「相似检测」页面逐一审视。`,
      affectedSkillIds: allIds,
    })
  }

  // ---- 3. Missing description ----
  const noDesc = skills.filter(
    (s) => !s.description || s.description.trim().length < 10,
  )
  if (noDesc.length > 0) {
    const pct = Math.round((noDesc.length / total) * 100)
    diagnostics.push({
      type: 'missing_description',
      severity: noDesc.length > total * 0.3 ? 'warn' : 'info',
      title: `${noDesc.length} 个 Skill 缺少有效描述 (${pct}%)`,
      detail: `好的 description 可将触发率从 20% 提升到 50%。这些 Skill 缺少描述或描述不足 10 字。`,
      affectedSkillIds: noDesc.map((s) => s.id),
    })
  }

  // ---- 4. Oversized content ----
  const oversized = skills.filter((s) => {
    const lines = s.content ? s.content.split('\n').length : 0
    return lines > CONTENT_LINE_LIMIT
  })
  if (oversized.length > 0) {
    diagnostics.push({
      type: 'oversized_content',
      severity: 'warn',
      title: `${oversized.length} 个 Skill 内容超过 ${CONTENT_LINE_LIMIT} 行`,
      detail: `Anthropic 建议 SKILL.md 控制在 500 行以内，超长内容应拆分到 references/ 目录。`,
      affectedSkillIds: oversized.map((s) => s.id),
    })
  }

  // ---- 5. Scope suggestion: global skills that look project-specific ----
  const projectKeywords = [
    'project', 'repo', 'repository', 'workspace', 'monorepo',
    '项目', '仓库', '工程',
  ]
  const suspectGlobal = skills.filter((s) => {
    if (s.scope !== 'global') return false
    const text = `${s.name} ${s.description}`.toLowerCase()
    return projectKeywords.some((kw) => text.includes(kw))
  })
  if (suspectGlobal.length > 0) {
    diagnostics.push({
      type: 'scope_suggestion',
      severity: 'info',
      title: `${suspectGlobal.length} 个全局 Skill 可能更适合放在项目级`,
      detail: `这些 Skill 的名称或描述中包含项目相关词汇。将它们移到项目级可以减少全局 Skill 总量，提高触发准确率。`,
      affectedSkillIds: suspectGlobal.map((s) => s.id),
    })
  }

  // ---- 6. Duplicate content (different name, same content hash) ----
  const contentMap = new Map<string, Skill[]>()
  for (const s of skills) {
    if (!s.content || s.content.trim().length < 20) continue
    // Simple hash: first 200 chars trimmed (avoids full hash for perf)
    const sig = s.content.trim().slice(0, 200)
    const arr = contentMap.get(sig) || []
    arr.push(s)
    contentMap.set(sig, arr)
  }
  const dupeGroups = [...contentMap.values()].filter((g) => g.length > 1)
  for (const group of dupeGroups) {
    diagnostics.push({
      type: 'duplicate_content',
      severity: 'danger',
      title: `内容重复：${group.map((s) => s.name).join(', ')}`,
      detail: `这 ${group.length} 个 Skill 的内容几乎完全相同，建议只保留一个。`,
      affectedSkillIds: group.map((s) => s.id),
    })
  }

  // ---- 7. Low quality trigger (no user-invocable, no clear trigger) ----
  const lowTrigger = skills.filter((s) => {
    const fm = s.frontmatter as any
    // Has explicit user-invocable setting — skip
    if (fm?.['user-invocable'] !== undefined) return false
    // Has description with trigger words — skip
    const desc = (s.description || '').toLowerCase()
    const triggerWords = ['当', 'when', '触发', 'trigger', '如果', 'if', '输入', '运行']
    if (triggerWords.some((w) => desc.includes(w))) return false
    // No clear trigger mechanism
    return true
  })
  if (lowTrigger.length > 3) {
    diagnostics.push({
      type: 'low_quality_trigger',
      severity: 'info',
      title: `${lowTrigger.length} 个 Skill 缺少明确的触发条件`,
      detail: `这些 Skill 没有设置 user-invocable，描述中也没有触发条件关键词。建议在描述中添加"当用户..."等触发语句。`,
      affectedSkillIds: lowTrigger.map((s) => s.id),
    })
  }

  // ---- Compute score ----
  let score = 100

  // Quantity penalty: beyond 20, -2 per extra skill (max -60)
  if (total > GREEN_MAX) {
    score -= Math.min(60, (total - GREEN_MAX) * 2)
  }

  // Semantic clash penalty: -5 per high-clash group, -2 per medium
  score -= highClashGroups.length * 5
  score -= medClashGroups.length * 2

  // Conflict penalty: -3 per conflict group
  score -= conflicts.length * 3

  // Missing description penalty: proportional
  if (total > 0) {
    score -= Math.round((noDesc.length / total) * 15)
  }

  // Merge suggestion penalty: -1 per suggestion (capped at 10)
  score -= Math.min(10, mergeSuggestions.length)

  // Duplicate penalty: -5 per duplicate group
  score -= dupeGroups.length * 5

  score = Math.max(0, Math.min(100, score))

  const level: HealthLevel =
    score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red'

  // Summary text
  let summary: string
  if (level === 'green') {
    summary = `Skill 配置健康 (${total} 个)，触发准确率预计 ${estimateAccuracy(total)}%+`
  } else if (level === 'yellow') {
    summary = `Skill 数量偏多 (${total} 个)，建议精简。预计准确率约 ${estimateAccuracy(total)}%`
  } else {
    summary = `Skill 配置需要优化 (${total} 个)，存在 ${diagnostics.filter((d) => d.severity === 'danger').length} 个严重问题`
  }

  // Sort diagnostics: danger > warn > info
  const severityOrder: Record<DiagnosticSeverity, number> = {
    danger: 0,
    warn: 1,
    info: 2,
  }
  diagnostics.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  return { level, score, summary, diagnostics }
}

/**
 * Rough accuracy estimate based on the paper's findings.
 * Uses a simplified curve fit: accuracy ≈ 96 * e^(-0.005 * (n-5)^1.3)
 * Clamped to [15, 96].
 */
function estimateAccuracy(n: number): number {
  if (n <= 5) return 96
  const raw = 96 * Math.exp(-0.005 * Math.pow(n - 5, 1.3))
  return Math.max(15, Math.min(96, Math.round(raw)))
}
