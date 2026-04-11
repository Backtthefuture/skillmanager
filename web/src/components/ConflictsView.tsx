import type { Skill, ConflictGroup } from '../hooks/useSkills'
import { AgentBadge } from './SourceBadge'

interface Props {
  conflicts: ConflictGroup[]
  onSkillClick: (skill: Skill) => void
  onDelete: (skill: Skill) => Promise<void>
  busy: Set<string>
}

export function ConflictsView({ conflicts, onSkillClick, onDelete, busy }: Props) {
  const total = conflicts.reduce((n, g) => n + g.skills.length, 0)

  return (
    <div>
      {/* Header */}
      <div className="mb-6 p-5 rounded-xl border border-amber-500/40 bg-amber-500/10">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-amber-300 flex items-center gap-2 mb-2">
              <span>⚠</span>
              <span>同名 Skill 冲突</span>
            </h2>
            <p className="text-sm text-slate-200 leading-relaxed">
              多个 Skill 使用同一个名字时,AI 工具(Claude Code / Codex 等)
              <strong className="text-amber-300 font-semibold"> 无法判断加载哪一个</strong>,
              常见表现是:调用时加载的不是你期望的版本,或某个 Skill 被静默忽略。
            </p>
            <p className="text-sm text-slate-200 leading-relaxed mt-2">
              <strong className="text-amber-300 font-semibold">处理方式:</strong>
              在每组中保留一个主版本,其他的<strong className="text-slate-100">移到回收站</strong>(7 天内可恢复)。
            </p>
            <p className="text-xs text-amber-200/80 leading-relaxed mt-2 bg-amber-500/10 rounded px-2 py-1.5 border border-amber-500/20">
              ⓘ 注意:Claude Code 的「禁用」机制是按 <code className="font-mono bg-slate-950/50 px-1 rounded">skill 名字</code> 生效的,<strong>无法单独禁用某一个副本</strong>(禁用一个等于禁用同名的全部)。所以冲突只能通过删除多余副本来解决。
            </p>
          </div>
          <div className="text-right shrink-0 border-l border-amber-500/20 pl-4">
            <div className="text-3xl font-bold text-amber-300 tabular-nums leading-none">{conflicts.length}</div>
            <div className="text-[11px] uppercase tracking-wider text-amber-200 mt-1">冲突组</div>
            <div className="text-[11px] text-slate-400 mt-1">共 {total} 个 Skill</div>
          </div>
        </div>
      </div>

      {conflicts.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">✨</div>
          <p className="text-sm">没有同名冲突</p>
          <p className="text-xs text-slate-600 mt-1">所有 Skill 的名字都是唯一的</p>
        </div>
      )}

      <div className="space-y-4">
        {conflicts.map((group) => (
          <ConflictGroupCard
            key={group.name}
            group={group}
            onSkillClick={onSkillClick}
            onDelete={onDelete}
            busy={busy}
          />
        ))}
      </div>
    </div>
  )
}

function ConflictGroupCard({
  group,
  onSkillClick,
  onDelete,
  busy,
}: {
  group: ConflictGroup
  onSkillClick: (skill: Skill) => void
  onDelete: (skill: Skill) => Promise<void>
  busy: Set<string>
}) {
  return (
    <div className="rounded-xl border border-amber-500/20 bg-slate-900/40 overflow-hidden">
      {/* Group header */}
      <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between gap-3 bg-amber-500/5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-amber-400 shrink-0">⚠</span>
          <span className="text-sm font-semibold text-slate-100 truncate">/{group.name}</span>
          <span className="text-[11px] text-slate-500 shrink-0">·</span>
          <span className="text-xs text-slate-400 shrink-0">{group.skills.length} 个同名副本</span>
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-slate-800/80">
        {group.skills.map((skill) => (
          <ConflictRow
            key={skill.id}
            skill={skill}
            onSkillClick={onSkillClick}
            onDelete={onDelete}
            isBusy={busy.has(skill.id)}
          />
        ))}
      </div>
    </div>
  )
}

function ConflictRow({
  skill,
  onSkillClick,
  onDelete,
  isBusy,
}: {
  skill: Skill
  onSkillClick: (skill: Skill) => void
  onDelete: (skill: Skill) => Promise<void>
  isBusy: boolean
}) {
  const scopeLabel = skill.scope === 'global' ? '全局' : skill.scope === 'plugin' ? '插件' : skill.projectName || '项目'
  const lastMod = formatRelative(skill.lastModified)

  return (
    <div className={`px-4 py-3 flex items-start justify-between gap-3 hover:bg-slate-800/30 transition-colors ${isBusy ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="flex-1 min-w-0">
        {/* Title row */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <AgentBadge agent={skill.agent} />
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
            {scopeLabel}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400">
            来源: {skill.source}
          </span>
          {lastMod && (
            <span className="text-[10px] text-slate-500">修改于 {lastMod}</span>
          )}
        </div>
        {skill.description && (
          <p className="text-xs text-slate-400 line-clamp-1 mb-1">{skill.description}</p>
        )}
        <p className="text-[11px] text-slate-500 truncate font-mono" title={skill.path}>
          {skill.path}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => onSkillClick(skill)}
          className="px-2.5 py-1 rounded-md text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
        >
          详情
        </button>
        <button
          onClick={() => onDelete(skill)}
          disabled={isBusy}
          className="px-2.5 py-1 rounded-md text-[11px] bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 transition-colors disabled:opacity-40"
        >
          {isBusy ? '处理中...' : '移到回收站'}
        </button>
      </div>
    </div>
  )
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso).getTime()
    const now = Date.now()
    const min = Math.floor((now - d) / 60_000)
    if (min < 60) return `${min} 分钟前`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h} 小时前`
    const days = Math.floor(h / 24)
    if (days < 30) return `${days} 天前`
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return ''
  }
}
