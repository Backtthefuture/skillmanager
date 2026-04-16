import type { Skill } from '../types.js'
import {
  BUILTIN_SYNONYMS,
  buildSynonymIndex,
  tokenize,
  jaccard,
} from './nlp.js'

// Re-export tokenize so existing external imports (if any) keep working.
export { tokenize }

export interface SimilarityPair {
  a: Skill
  b: Skill
  score: number
  sharedTokens: string[]
}

export interface SimilarityGroup {
  id: string
  skills: Skill[]
  sharedTokens: string[]
  averageSimilarity: number
}

export interface SimilarityOptions {
  threshold?: number
  extraSynonyms?: Record<string, string[]>
  ignoredPairs?: Array<[string, string]> // pairs of skill ids
}

/**
 * Build a skill → signature token set, using name + description + frontmatter.keywords.
 */
function signatureFor(
  skill: Skill,
  synonymIndex: Map<string, string>,
): Set<string> {
  const parts: string[] = []
  parts.push(skill.name)
  if (skill.description) parts.push(skill.description)
  const kw = (skill.frontmatter as any)?.keywords
  if (Array.isArray(kw)) parts.push(kw.join(' '))
  return tokenize(parts.join(' '), synonymIndex)
}

/**
 * Cluster skills into similarity groups via single-linkage clustering over
 * pairs whose Jaccard similarity exceeds the threshold.
 */
export function detectSimilarSkills(
  skills: Skill[],
  options: SimilarityOptions = {},
): SimilarityGroup[] {
  const threshold = options.threshold ?? 0.25
  const synonyms = { ...BUILTIN_SYNONYMS, ...(options.extraSynonyms || {}) }
  const synonymIndex = buildSynonymIndex(synonyms)

  const ignored = new Set<string>()
  for (const [a, b] of options.ignoredPairs || []) {
    ignored.add(a < b ? `${a}|${b}` : `${b}|${a}`)
  }

  // 1. Compute signatures
  const sigs = new Map<string, Set<string>>()
  for (const s of skills) {
    sigs.set(s.id, signatureFor(s, synonymIndex))
  }

  // 2. Collect pairs above threshold. Skip exact-name duplicates (already shown as conflicts).
  const pairs: SimilarityPair[] = []
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const a = skills[i]
      const b = skills[j]
      if (a.name === b.name) continue // covered by conflict detection
      const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
      if (ignored.has(pairKey)) continue
      const sa = sigs.get(a.id)!
      const sb = sigs.get(b.id)!
      const score = jaccard(sa, sb)
      if (score >= threshold) {
        const shared: string[] = []
        for (const t of sa) if (sb.has(t)) shared.push(t)
        pairs.push({ a, b, score, sharedTokens: shared })
      }
    }
  }

  // 3. Union-Find to cluster via single linkage
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
    return parent.get(x)!
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const s of skills) parent.set(s.id, s.id)
  for (const p of pairs) union(p.a.id, p.b.id)

  // 4. Gather clusters that have ≥ 2 members
  const clusters = new Map<string, Skill[]>()
  for (const s of skills) {
    const r = find(s.id)
    const arr = clusters.get(r) || []
    arr.push(s)
    clusters.set(r, arr)
  }

  const groups: SimilarityGroup[] = []
  for (const [rootId, members] of clusters) {
    if (members.length < 2) continue

    // Compute shared token intersection + avg similarity for display
    const memberSigs = members.map((m) => sigs.get(m.id)!)
    let sharedTokens = new Set(memberSigs[0])
    for (let i = 1; i < memberSigs.length; i++) {
      const next = new Set<string>()
      for (const t of sharedTokens) if (memberSigs[i].has(t)) next.add(t)
      sharedTokens = next
    }

    // Avg of all pairwise similarities within the cluster
    let sum = 0
    let count = 0
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        sum += jaccard(memberSigs[i], memberSigs[j])
        count++
      }
    }
    const avg = count === 0 ? 0 : sum / count

    groups.push({
      id: rootId,
      skills: members.sort((a, b) => a.name.localeCompare(b.name)),
      sharedTokens: Array.from(sharedTokens).slice(0, 8),
      averageSimilarity: Math.round(avg * 100) / 100,
    })
  }

  // Sort: highest similarity first, then largest group
  groups.sort((x, y) => {
    if (y.averageSimilarity !== x.averageSimilarity) {
      return y.averageSimilarity - x.averageSimilarity
    }
    return y.skills.length - x.skills.length
  })

  return groups
}
