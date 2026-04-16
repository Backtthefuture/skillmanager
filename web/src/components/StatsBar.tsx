import type { Stats, Project } from '../hooks/useSkills'
import type { HealthReport } from './HealthPanel'

interface StatsBarProps {
  stats: Stats
  projects: Project[]
  conflicts: number
  health: HealthReport | null
}

const healthDot: Record<string, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
}

export function StatsBar({ stats, projects, conflicts, health }: StatsBarProps) {
  const cards = [
    { label: '总计', value: stats.total, color: 'text-slate-100', bg: 'from-slate-800 to-slate-800/50' },
    { label: '全局', value: stats.global, color: 'text-indigo-400', bg: 'from-indigo-950/40 to-slate-800/50' },
    { label: '项目级', value: stats.project, color: 'text-amber-400', bg: 'from-amber-950/40 to-slate-800/50' },
    { label: '来源', value: Object.keys(stats.bySource).length, color: 'text-cyan-400', bg: 'from-cyan-950/40 to-slate-800/50' },
    { label: '项目', value: projects.length, color: 'text-green-400', bg: 'from-green-950/40 to-slate-800/50' },
    { label: '冲突', value: conflicts, color: conflicts > 0 ? 'text-amber-400' : 'text-slate-500', bg: conflicts > 0 ? 'from-amber-950/40 to-slate-800/50' : 'from-slate-800 to-slate-800/50' },
  ]

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
      {cards.map((c, i) => (
        <div key={c.label} className={`relative rounded-xl bg-gradient-to-br ${c.bg} border border-slate-800/80 px-4 py-3`}>
          <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
          <div className="text-xs text-slate-500 mt-0.5">{c.label}</div>
          {i === 0 && health && (
            <div
              className="absolute top-2.5 right-2.5 flex items-center gap-1.5"
              title={`健康评分 ${health.score}/100 — ${health.summary}`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${healthDot[health.level] || healthDot.red} animate-pulse`} />
              <span className="text-[10px] text-slate-500 font-medium">{health.score}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
