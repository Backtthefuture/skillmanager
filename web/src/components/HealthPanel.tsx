import { useState } from 'react'
import type { Skill } from '../hooks/useSkills'
import { getCategoryMeta } from './CategoryBadge'

export interface Diagnostic {
  type: string
  severity: 'info' | 'warn' | 'danger'
  title: string
  detail: string
  affectedSkillIds: string[]
}

export interface HealthReport {
  level: 'green' | 'yellow' | 'red'
  score: number
  summary: string
  diagnostics: Diagnostic[]
}

export interface MergeSuggestion {
  category: string
  categoryName: string
  reason: string
  skills: { id: string; name: string }[]
  similarity: number
}

export interface CategorySummary {
  id: string
  name: string
  icon: string
  count: number
  skillIds: string[]
}

interface Props {
  health: HealthReport | null
  mergeSuggestions: MergeSuggestion[]
  categories: CategorySummary[]
  skills: Skill[]
  onSkillClick?: (skill: Skill) => void
}

const levelConfig = {
  green:  { color: 'text-green-400',  ring: 'stroke-green-500',  bg: 'bg-green-500/10',  border: 'border-green-500/20',  label: '健康' },
  yellow: { color: 'text-yellow-400', ring: 'stroke-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', label: '需关注' },
  red:    { color: 'text-red-400',    ring: 'stroke-red-500',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    label: '需优化' },
}

const severityConfig = {
  danger: { bg: 'bg-red-500/10',    border: 'border-red-500/20',    dot: 'bg-red-500',    text: 'text-red-400' },
  warn:   { bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', dot: 'bg-yellow-500', text: 'text-yellow-400' },
  info:   { bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   dot: 'bg-blue-500',   text: 'text-blue-400' },
}

export function HealthPanel({ health, mergeSuggestions, categories, skills, onSkillClick }: Props) {
  const [expandedDiag, setExpandedDiag] = useState<Set<number>>(new Set())

  if (!health) return null

  const cfg = levelConfig[health.level]
  const circumference = 2 * Math.PI * 40
  const offset = circumference - (health.score / 100) * circumference

  const toggleDiag = (i: number) => {
    setExpandedDiag((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const skillById = new Map(skills.map((s) => [s.id, s]))

  return (
    <div className="space-y-5">
      {/* Score + Summary */}
      <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-5`}>
        <div className="flex items-center gap-6">
          {/* Score ring */}
          <div className="relative shrink-0">
            <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
              <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="6" className="text-slate-800" />
              <circle
                cx="48" cy="48" r="40" fill="none" strokeWidth="6"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                className={cfg.ring}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-2xl font-bold ${cfg.color}`}>{health.score}</span>
              <span className="text-[10px] text-slate-500">/ 100</span>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
              <span className={`w-2 h-2 rounded-full ${cfg.color === 'text-green-400' ? 'bg-green-500' : cfg.color === 'text-yellow-400' ? 'bg-yellow-500' : 'bg-red-500'}`} />
            </div>
            <p className="text-sm text-slate-300 mb-2">{health.summary}</p>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>
                <span className="text-red-400 font-medium">{health.diagnostics.filter((d) => d.severity === 'danger').length}</span> 严重
              </span>
              <span>
                <span className="text-yellow-400 font-medium">{health.diagnostics.filter((d) => d.severity === 'warn').length}</span> 警告
              </span>
              <span>
                <span className="text-blue-400 font-medium">{health.diagnostics.filter((d) => d.severity === 'info').length}</span> 建议
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Diagnostics */}
      {health.diagnostics.length > 0 && (
        <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">诊断详情</h3>
          <div className="space-y-2">
            {health.diagnostics.map((d, i) => {
              const sc = severityConfig[d.severity]
              const expanded = expandedDiag.has(i)
              const affected = d.affectedSkillIds
                .map((id) => skillById.get(id))
                .filter((s): s is Skill => !!s)

              return (
                <div key={i} className={`rounded-lg border ${sc.border} ${sc.bg}`}>
                  <button
                    onClick={() => toggleDiag(i)}
                    className="w-full text-left px-4 py-3 flex items-start gap-3"
                  >
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${sc.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium ${sc.text}`}>{d.title}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{d.detail}</div>
                    </div>
                    {affected.length > 0 && (
                      <span className="text-[10px] text-slate-500 shrink-0 mt-1">
                        {affected.length} 个 Skill {expanded ? '▲' : '▼'}
                      </span>
                    )}
                  </button>
                  {expanded && affected.length > 0 && (
                    <div className="px-4 pb-3 border-t border-slate-800/40">
                      <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                        {affected.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => onSkillClick?.(s)}
                            className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-800/50 transition-colors text-xs"
                          >
                            <span className="text-slate-300 font-medium truncate">/{s.name}</span>
                            <span className="text-[10px] text-slate-600">{s.scope}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Merge Suggestions */}
      {mergeSuggestions.length > 0 && (
        <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-1">合并建议</h3>
          <p className="text-xs text-slate-500 mb-3">
            同分类下语义高度相似的 Skill，建议合并为一个包含子场景的 Skill
          </p>
          <div className="space-y-2">
            {mergeSuggestions.map((ms, i) => {
              const catMeta = getCategoryMeta(ms.category)
              return (
                <div
                  key={i}
                  className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-3"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs">{catMeta.icon}</span>
                    <span className="text-xs text-purple-300 font-medium">{catMeta.name}</span>
                    <span className="text-[10px] text-purple-400/60">
                      相似度 {Math.round(ms.similarity * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {ms.skills.map((s, j) => (
                      <span key={j}>
                        <button
                          onClick={() => {
                            const full = skillById.get(s.id)
                            if (full) onSkillClick?.(full)
                          }}
                          className="text-xs text-slate-200 hover:text-purple-300 transition-colors"
                        >
                          /{s.name}
                        </button>
                        {j < ms.skills.length - 1 && (
                          <span className="text-slate-600 text-xs mx-1">+</span>
                        )}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">{ms.reason}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Category Distribution */}
      {categories.length > 0 && (
        <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">分类分布</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {categories.map((cat) => {
              const meta = getCategoryMeta(cat.id)
              return (
                <div
                  key={cat.id}
                  className="bg-slate-900/50 rounded-lg border border-slate-800/40 p-3"
                >
                  <div className="text-lg mb-1">{meta.icon}</div>
                  <div className="text-lg font-bold text-slate-200">{cat.count}</div>
                  <div className="text-[11px] text-slate-500">{meta.name}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
