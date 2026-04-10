import { useEffect } from 'react'
import type { HealthData, SkillHealth } from '../hooks/useHealth'

interface Props {
  data: HealthData | null
  running: boolean
  onRunCheck: () => void
  onSkillClick?: (name: string) => void
}

function ScoreBar({ score, max = 25, color }: { score: number; max?: number; color: string }) {
  const pct = Math.round((score / max) * 100)
  return (
    <div className="w-full bg-slate-800 rounded-full h-2">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'text-green-400 bg-green-500/20' :
                score >= 50 ? 'text-amber-400 bg-amber-500/20' :
                'text-red-400 bg-red-500/20'
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>
      {score}
    </span>
  )
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    content_producer: 'bg-purple-500/20 text-purple-400',
    tool: 'bg-cyan-500/20 text-cyan-400',
    workflow: 'bg-amber-500/20 text-amber-400',
  }
  const labels: Record<string, string> = {
    content_producer: '内容',
    tool: '工具',
    workflow: '工作流',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] ${colors[category] || 'bg-slate-700 text-slate-400'}`}>
      {labels[category] || category}
    </span>
  )
}

function StaleIndicator({ level, days }: { level: string; days: number }) {
  if (level === 'active') return null
  const color = level === 'dormant' ? 'text-red-400' : 'text-amber-400'
  return <span className={`text-[10px] ${color}`}>{days}天未更新</span>
}

export function HealthDashboard({ data, running, onRunCheck, onSkillClick }: Props) {
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-4xl">🏥</div>
        <p className="text-slate-300">暂无健康检查数据</p>
        <p className="text-sm text-slate-500">点击下方按钮运行一次健康检查</p>
        <button
          onClick={onRunCheck}
          disabled={running}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-all flex items-center gap-2"
        >
          {running ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : null}
          {running ? '检查中...' : '运行健康检查'}
        </button>
      </div>
    )
  }

  const { summary, skills, timestamp, duration_ms, total_checked } = data

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-800/60 bg-gradient-to-br from-slate-800/40 to-slate-800/20 p-4">
          <div className="text-2xl font-bold text-slate-100">{total_checked}</div>
          <div className="text-xs text-slate-500">已检查</div>
        </div>
        <div className="rounded-xl border border-green-500/20 bg-gradient-to-br from-green-950/30 to-slate-800/20 p-4">
          <div className="text-2xl font-bold text-green-400">{summary.healthy}</div>
          <div className="text-xs text-slate-500">健康</div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-950/30 to-slate-800/20 p-4">
          <div className="text-2xl font-bold text-amber-400">{summary.warning}</div>
          <div className="text-xs text-slate-500">警告</div>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-gradient-to-br from-red-950/30 to-slate-800/20 p-4">
          <div className="text-2xl font-bold text-red-400">{summary.critical}</div>
          <div className="text-xs text-slate-500">严重</div>
        </div>
        <div className="rounded-xl border border-slate-800/60 bg-gradient-to-br from-slate-800/40 to-slate-800/20 p-4">
          <div className="text-sm font-mono text-slate-300">{(duration_ms / 1000).toFixed(1)}s</div>
          <div className="text-xs text-slate-500 mt-1">{new Date(timestamp).toLocaleString('zh-CN')}</div>
        </div>
      </div>

      {/* Run button */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">
          上次检查: {new Date(timestamp).toLocaleTimeString('zh-CN')}
        </span>
        <button
          onClick={onRunCheck}
          disabled={running}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-all flex items-center gap-2"
        >
          {running ? (
            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : null}
          {running ? '检查中...' : '重新检查'}
        </button>
      </div>

      {/* Skills table */}
      <div className="rounded-xl border border-slate-800/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900/50 text-slate-400 text-xs">
              <th className="text-left px-4 py-2.5">Skill</th>
              <th className="text-center px-2 py-2.5 hidden md:table-cell">分类</th>
              <th className="text-center px-2 py-2.5">评分</th>
              <th className="text-center px-2 py-2.5 hidden lg:table-cell">代码</th>
              <th className="text-center px-2 py-2.5 hidden lg:table-cell">Git</th>
              <th className="text-center px-2 py-2.5 hidden lg:table-cell">运行</th>
              <th className="text-center px-2 py-2.5 hidden lg:table-cell">活跃</th>
              <th className="text-left px-4 py-2.5 hidden md:table-cell">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {skills.map((skill) => (
              <tr
                key={skill.name}
                className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                onClick={() => onSkillClick?.(skill.name)}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{skill.status_icon}</span>
                    <div>
                      <div className="text-slate-200 font-medium">{skill.name}</div>
                      {skill.version && (
                        <span className="text-[10px] text-slate-500">v{skill.version}</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2.5 text-center hidden md:table-cell">
                  <CategoryBadge category={skill.category} />
                </td>
                <td className="px-2 py-2.5 text-center">
                  <ScoreBadge score={skill.health_score} />
                </td>
                <td className="px-2 py-2.5 hidden lg:table-cell">
                  <ScoreBar score={skill.scores.code_quality} color="bg-indigo-500" />
                </td>
                <td className="px-2 py-2.5 hidden lg:table-cell">
                  <ScoreBar score={skill.scores.git_sync} color="bg-cyan-500" />
                </td>
                <td className="px-2 py-2.5 hidden lg:table-cell">
                  <ScoreBar score={skill.scores.runtime_health} color="bg-green-500" />
                </td>
                <td className="px-2 py-2.5 hidden lg:table-cell">
                  <ScoreBar score={skill.scores.activity} color="bg-amber-500" />
                </td>
                <td className="px-4 py-2.5 hidden md:table-cell">
                  <div className="flex flex-col gap-0.5">
                    <StaleIndicator level={skill.staleness_level} days={skill.staleness_days} />
                    {skill.issues.length > 0 && (
                      <span className="text-[10px] text-red-400 truncate max-w-[200px]">
                        {skill.issues[0]}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
