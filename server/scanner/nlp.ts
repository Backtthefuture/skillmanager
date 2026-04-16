/**
 * Shared NLP utilities for similarity detection and taxonomy classification.
 *
 * Extracted from similarity.ts so that taxonomy.ts and health.ts can reuse
 * the same tokenizer, synonym table, and distance function without circular
 * dependencies.
 */

// Built-in synonyms — extend via ~/.claude/skill-hub/synonyms.json if needed.
export const BUILTIN_SYNONYMS: Record<string, string[]> = {
  小红书: ['xhs', 'rednote', '种草', '小红薯', 'xiaohongshu'],
  视频: ['video', 'vlog', 'movie', 'mp4'],
  图片: ['image', 'img', 'picture', 'pic', 'photo'],
  飞书: ['lark', 'feishu'],
  公众号: ['wechat', 'mp', 'gzh', 'wx'],
  推特: ['twitter', 'x', 'tweet'],
  邮件: ['email', 'mail', 'gmail'],
  日报: ['daily', 'report', 'digest'],
  会议: ['meeting', 'minutes', '纪要'],
  文档: ['doc', 'document', 'markdown', 'md'],
  表格: ['sheet', 'spreadsheet', 'excel', 'xlsx', 'csv'],
  幻灯片: ['ppt', 'pptx', 'slide', 'presentation'],
  翻译: ['translate', 'translation', 'i18n'],
  生成: ['generate', 'create', 'make', '制作', '创建'],
  抓取: ['fetch', 'scrape', 'crawl', '爬取'],
  发布: ['publish', 'post', 'deploy', '推送'],
  分析: ['analyze', 'analysis', 'analytics', '拆解'],
  测试: ['test', 'testing', 'qa'],
  代码: ['code', 'coding', 'program'],
  设计: ['design', 'designer', 'ui'],
  人格: ['personality', 'mbti', 'sbti', 'persona'],
  访谈: ['interview', '采访'],
  发票: ['invoice', 'receipt', '收据'],
}

// Stop words — too common to be useful as similarity signal.
export const STOP_WORDS = new Set([
  // Chinese stop tokens
  '使用', '当用', '用户', '提到', '触发', '支持', '需要', '可以', '自动', '一个', '这个', '进行',
  '工具', '技能', '功能', '场景', '命令', '文件', '内容', '数据', '信息', '结果',
  '或者', '按照', '根据', '然后', '基于', '提供', '我们', '所以', '因此', '以及',
  // English stop tokens
  'skill', 'use', 'used', 'using', 'usage', 'when', 'user', 'users', 'the', 'and', 'for', 'with',
  'from', 'this', 'that', 'these', 'those', 'can', 'any', 'all', 'auto', 'support', 'supports',
  'tool', 'tools', 'create', 'creates', 'creating', 'generate', 'generates', 'make', 'makes',
  'do', 'does', 'get', 'gets', 'set', 'sets', 'should', 'would', 'could', 'will', 'want',
  'add', 'adds', 'added', 'adding', 'need', 'needs', 'needed', 'guidance', 'guide', 'guides',
  'help', 'helps', 'helper', 'ensure', 'allow', 'allows', 'asks', 'ask', 'asked',
  'mention', 'mentions', 'mentioned', 'provide', 'provides', 'provided', 'request', 'requests',
  'requested', 'include', 'includes', 'included', 'contains', 'content', 'text', 'task',
  'tasks', 'file', 'files', 'code', 'new', 'each', 'also', 'other', 'over', 'into', 'more',
  'most', 'some', 'such', 'than', 'only', 'very', 'like', 'just', 'between', 'based',
  'handle', 'handles', 'handled', 'process', 'processing', 'processed', 'system', 'systems',
])

/**
 * Normalize a raw token into its canonical form using the synonym table.
 * Everything is lowercased; Chinese is left as-is.
 */
export function buildSynonymIndex(synonyms: Record<string, string[]>): Map<string, string> {
  const index = new Map<string, string>()
  for (const [canonical, aliases] of Object.entries(synonyms)) {
    index.set(canonical.toLowerCase(), canonical.toLowerCase())
    for (const a of aliases) {
      index.set(a.toLowerCase(), canonical.toLowerCase())
    }
  }
  return index
}

/**
 * Tokenize a string into a set of normalized tokens.
 * - English: split on non-word; drop short/stopword
 * - Chinese (CJK range): generate character bigrams so "小红书" contributes
 *   "小红" + "红书" tokens that can match against the "小红书" synonym key after merging.
 *   Also emit the full 3-gram when possible.
 */
export function tokenize(text: string, synonymIndex: Map<string, string>): Set<string> {
  const out = new Set<string>()
  if (!text) return out
  const lower = text.toLowerCase()

  // 1. English / ASCII words
  const words = lower.match(/[a-z][a-z0-9_-]{1,}/g) || []
  for (const w of words) {
    if (STOP_WORDS.has(w)) continue
    if (w.length < 3) continue
    out.add(synonymIndex.get(w) || w)
  }

  // 2. Chinese n-grams (bigram + trigram on CJK spans)
  const cjkSpans = lower.match(/[\u4e00-\u9fff]+/g) || []
  for (const span of cjkSpans) {
    // Try to match synonym keys first by sliding full length
    for (const key of synonymIndex.keys()) {
      if (/^[\u4e00-\u9fff]+$/.test(key) && span.includes(key)) {
        out.add(synonymIndex.get(key)!)
      }
    }
    // Bigrams
    for (let i = 0; i < span.length - 1; i++) {
      const bg = span.slice(i, i + 2)
      if (STOP_WORDS.has(bg)) continue
      out.add(bg)
    }
  }

  return out
}

/**
 * Jaccard similarity between two token sets.
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersect = 0
  for (const x of a) if (b.has(x)) intersect++
  const union = a.size + b.size - intersect
  return union === 0 ? 0 : intersect / union
}
