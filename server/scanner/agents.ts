import path from 'path'

export type AgentId =
  | 'claude-code'
  | 'codex'
  | 'antigravity'
  | 'augment'
  | 'bob'
  | 'openclaw'
  | 'codebuddy'
  | 'universal'
  | 'unknown'

export interface AgentDef {
  id: AgentId
  name: string
  icon: string
  globalPaths: string[]
  projectPaths: string[]
}

/**
 * Registry of all supported agents. Mirrors the Supported Agents table from
 * https://www.npmjs.com/package/skills
 *
 * Notes:
 * - `.agents/skills/` is the shared/universal path used by Amp, Kimi, Replit,
 *   Codex, Cline, Warp. We can't tell them apart at the filesystem level, so
 *   anything found there is attributed to the `universal` pseudo-agent.
 *   Users who want stricter attribution should add `agent: <id>` to the skill
 *   frontmatter, which overrides the path-based guess.
 * - OpenClaw's project path is a bare `skills/` which would false-positive on
 *   any repo with a top-level skills dir. We skip it — only the global path
 *   is scanned. TODO: gate on a marker file if OpenClaw users report misses.
 */
export const AGENTS: AgentDef[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    icon: '🤖',
    globalPaths: ['.claude/skills'],
    projectPaths: ['.claude/skills'],
  },
  {
    id: 'codex',
    name: 'Codex',
    icon: '💻',
    globalPaths: ['.codex/skills'],
    projectPaths: [],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    icon: '🌌',
    globalPaths: ['.gemini/antigravity/skills'],
    projectPaths: ['.antigravity/skills'],
  },
  {
    id: 'augment',
    name: 'Augment',
    icon: '⚡',
    globalPaths: ['.augment/skills'],
    projectPaths: ['.augment/skills'],
  },
  {
    id: 'bob',
    name: 'IBM Bob',
    icon: '🤝',
    globalPaths: ['.bob/skills'],
    projectPaths: ['.bob/skills'],
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    icon: '🦀',
    globalPaths: ['.openclaw/skills'],
    projectPaths: [],
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    icon: '👥',
    globalPaths: ['.codebuddy/skills'],
    projectPaths: ['.codebuddy/skills'],
  },
  {
    id: 'universal',
    name: 'Universal (Amp/Codex/Cline/Warp/…)',
    icon: '🌐',
    globalPaths: ['.agents/skills', '.config/agents/skills'],
    projectPaths: ['.agents/skills'],
  },
]

const VALID_AGENT_IDS = new Set<string>(AGENTS.map((a) => a.id))

export function isValidAgentId(s: string): s is AgentId {
  return VALID_AGENT_IDS.has(s)
}

export function allAgentProjectRelPaths(): string[] {
  const set = new Set<string>()
  for (const a of AGENTS) for (const p of a.projectPaths) set.add(p)
  return Array.from(set)
}

export function allAgentGlobalAbsPaths(homedir: string): { agent: AgentDef; path: string }[] {
  const out: { agent: AgentDef; path: string }[] = []
  for (const a of AGENTS) for (const rel of a.globalPaths) out.push({ agent: a, path: path.join(homedir, rel) })
  return out
}
