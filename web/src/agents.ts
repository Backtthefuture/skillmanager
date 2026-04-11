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

export interface AgentMeta {
  id: AgentId
  name: string
  icon: string
  color: { bg: string; text: string; ring: string }
}

// Mirrors server/scanner/agents.ts. Kept in sync by hand — the registry is small
// and the frontend needs colors the server doesn't care about.
export const AGENT_META: Record<AgentId, AgentMeta> = {
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    icon: '🤖',
    color: { bg: 'bg-orange-500/15', text: 'text-orange-300', ring: 'ring-orange-500/30' },
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    icon: '💻',
    color: { bg: 'bg-slate-500/20', text: 'text-slate-200', ring: 'ring-slate-400/30' },
  },
  antigravity: {
    id: 'antigravity',
    name: 'Antigravity',
    icon: '🌌',
    color: { bg: 'bg-purple-500/15', text: 'text-purple-300', ring: 'ring-purple-500/30' },
  },
  augment: {
    id: 'augment',
    name: 'Augment',
    icon: '⚡',
    color: { bg: 'bg-blue-500/15', text: 'text-blue-300', ring: 'ring-blue-500/30' },
  },
  bob: {
    id: 'bob',
    name: 'IBM Bob',
    icon: '🤝',
    color: { bg: 'bg-cyan-500/15', text: 'text-cyan-300', ring: 'ring-cyan-500/30' },
  },
  openclaw: {
    id: 'openclaw',
    name: 'OpenClaw',
    icon: '🦀',
    color: { bg: 'bg-red-500/15', text: 'text-red-300', ring: 'ring-red-500/30' },
  },
  codebuddy: {
    id: 'codebuddy',
    name: 'CodeBuddy',
    icon: '👥',
    color: { bg: 'bg-green-500/15', text: 'text-green-300', ring: 'ring-green-500/30' },
  },
  universal: {
    id: 'universal',
    name: 'Universal',
    icon: '🌐',
    color: { bg: 'bg-indigo-500/15', text: 'text-indigo-300', ring: 'ring-indigo-500/30' },
  },
  unknown: {
    id: 'unknown',
    name: '未知',
    icon: '❔',
    color: { bg: 'bg-gray-500/15', text: 'text-gray-400', ring: 'ring-gray-500/30' },
  },
}

export const AGENT_ORDER: AgentId[] = [
  'claude-code',
  'codex',
  'antigravity',
  'augment',
  'bob',
  'openclaw',
  'codebuddy',
  'universal',
  'unknown',
]

export function getAgentMeta(id: string): AgentMeta {
  return AGENT_META[id as AgentId] || AGENT_META.unknown
}
