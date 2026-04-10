import { useCallback, useEffect, useState } from 'react'

export interface TrashItem {
  id: string
  skillName: string
  originalPath: string
  scope: 'global' | 'project' | 'unknown'
  projectPath?: string
  isSymlink: boolean
  symlinkTarget?: string
  deletedAt: string
  expiresAt: string
  sizeBytes?: number
  daysRemaining: number
}

interface TrashViewProps {
  onCountChange?: (count: number) => void
  onRestored?: () => void
}

export function TrashView({ onCountChange, onRestored }: TrashViewProps) {
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/trash')
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || '加载失败')
      setItems(data.items || [])
      onCountChange?.(data.items?.length || 0)
    } catch (e: any) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [onCountChange])

  useEffect(() => {
    load()
  }, [load])

  const handleRestore = async (item: TrashItem) => {
    setBusy(item.id)
    try {
      let res = await fetch(`/api/trash/${item.id}/restore`, { method: 'POST' })
      let data = await res.json()

      if (res.status === 409 && data.code === 'CONFLICT') {
        const ok = window.confirm(
          `目标位置已存在同名 Skill：\n${data.targetPath}\n\n是否覆盖？\n（现有的会被先移入回收站作为保底）`,
        )
        if (!ok) {
          setBusy(null)
          return
        }
        res = await fetch(`/api/trash/${item.id}/restore?force=true`, { method: 'POST' })
        data = await res.json()
      }

      if (!data.ok) throw new Error(data.error || '还原失败')
      showMsg('success', `已还原 ${item.skillName}`)
      await load()
      onRestored?.()
    } catch (e: any) {
      showMsg('error', e?.message || '还原失败')
    } finally {
      setBusy(null)
    }
  }

  const handlePurge = async (item: TrashItem) => {
    const ok = window.confirm(
      `彻底删除「${item.skillName}」？\n此操作不可恢复。`,
    )
    if (!ok) return
    setBusy(item.id)
    try {
      const res = await fetch(`/api/trash/${item.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.ok) throw new Error('删除失败')
      showMsg('success', '已彻底删除')
      await load()
    } catch (e: any) {
      showMsg('error', e?.message || '删除失败')
    } finally {
      setBusy(null)
    }
  }

  const formatSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDate = (iso: string) => new Date(iso).toLocaleString('zh-CN')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-200">回收站</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            删除的 Skill 会保留 7 天，过期自动清除。共 {items.length} 项
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 disabled:opacity-50"
        >
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      {message && (
        <div
          className={`px-3 py-2 rounded-lg text-xs ${
            message.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded-lg text-xs bg-red-500/10 text-red-400">{error}</div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-4xl mb-3">🗑</div>
            <p className="text-slate-300 mb-1">回收站是空的</p>
            <p className="text-xs text-slate-500">被删除的 Skill 会出现在这里，7 天后自动清除</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {items.map((item) => {
          const urgent = item.daysRemaining <= 1
          return (
            <div
              key={item.id}
              className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-slate-200 truncate">
                      /{item.skillName}
                    </h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wider">
                      {item.scope === 'global' ? '全局' : item.scope === 'project' ? '项目' : '未知'}
                    </span>
                    {item.isSymlink && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">
                        符号链接
                      </span>
                    )}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        urgent ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/10 text-amber-300'
                      }`}
                    >
                      剩余 {item.daysRemaining} 天
                    </span>
                  </div>

                  <div className="mt-2 space-y-1 text-xs text-slate-500">
                    <div className="font-mono break-all">
                      <span className="text-slate-600">原路径：</span>
                      <span className="text-slate-400">{item.originalPath}</span>
                    </div>
                    {item.isSymlink && item.symlinkTarget && (
                      <div className="font-mono break-all">
                        <span className="text-slate-600">指向：</span>
                        <span className="text-slate-400">{item.symlinkTarget}</span>
                      </div>
                    )}
                    <div className="flex gap-3 flex-wrap text-slate-500">
                      <span>删除于 {formatDate(item.deletedAt)}</span>
                      {item.sizeBytes ? <span>大小 {formatSize(item.sizeBytes)}</span> : null}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleRestore(item)}
                    disabled={busy === item.id}
                    className="px-3 py-1.5 rounded-lg bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs font-medium disabled:opacity-50 transition-colors"
                  >
                    {busy === item.id ? '...' : '还原'}
                  </button>
                  <button
                    onClick={() => handlePurge(item)}
                    disabled={busy === item.id}
                    className="px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-medium disabled:opacity-50 transition-colors"
                  >
                    彻底删除
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
