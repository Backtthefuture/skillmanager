import { useCallback, useEffect, useState } from 'react'

interface PublicSyncConfig {
  connected: boolean
  repoUrl: string | null
  owner: string | null
  name: string | null
  defaultBranch: string | null
  hasToken: boolean
  lastValidatedAt: string | null
}

export function SyncView() {
  const [config, setConfig] = useState<PublicSyncConfig | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sync/config')
      const data = await res.json()
      setConfig(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-100 mb-1">GitHub 同步</h2>
        <p className="text-sm text-slate-500">
          把你的 Skills 备份到 GitHub 仓库,方便在多台电脑之间传输。
        </p>
      </div>

      {config?.connected ? (
        <ConnectedPanel config={config} onDisconnect={fetchConfig} onRevalidated={fetchConfig} />
      ) : (
        <ConnectForm onConnected={fetchConfig} />
      )}
      <ExportSection />
    </div>
  )
}

function ExportSection() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/sync/export/tar')
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '导出失败' }))
        setError(data.error || `HTTP ${res.status}`)
        return
      }
      const skillCount = res.headers.get('X-Skill-Count') || '?'
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const cd = res.headers.get('Content-Disposition') || ''
      const match = cd.match(/filename="([^"]+)"/)
      const filename = match?.[1] || 'skill-hub-backup.tar.gz'
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      console.info(`[skill-hub] exported ${skillCount} skills as ${filename}`)
    } catch (e: any) {
      setError(e?.message || '导出失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-1">导出为 tar.gz(离线备份)</h3>
          <p className="text-xs text-slate-500">
            不想用 GitHub?直接导出一个压缩包,解压后把 <code className="text-slate-400 bg-slate-950 px-1 rounded">&lt;agent&gt;/&lt;skill&gt;/</code> 目录拷贝到目标机器即可。
          </p>
        </div>
        <button
          onClick={download}
          disabled={busy}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-lg text-xs text-slate-300 whitespace-nowrap"
        >
          {busy ? '打包中...' : '下载 .tar.gz'}
        </button>
      </div>
      {error && (
        <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}
    </div>
  )
}

function ConnectForm({ onConnected }: { onConnected: () => void }) {
  const [repoUrl, setRepoUrl] = useState('')
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (endpoint: '/api/sync/validate' | '/api/sync/config') => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl, token }),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || '未知错误')
        return null
      }
      return data
    } catch (e: any) {
      setError(e?.message || '请求失败')
      return null
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-5">
      <div>
        <label className="block text-xs text-slate-400 mb-1.5 font-medium">GitHub 仓库地址</label>
        <input
          type="text"
          placeholder="https://github.com/用户名/仓库名  或  用户名/仓库名"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
        />
        <p className="text-[11px] text-slate-600 mt-1.5">
          建议使用一个新的私有仓库。如果还没有,可以先到 GitHub 创建一个空仓库。
        </p>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5 font-medium">
          Personal Access Token
        </label>
        <input
          type="password"
          placeholder="ghp_... 或 github_pat_..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 font-mono"
        />
        <p className="text-[11px] text-slate-600 mt-1.5">
          <a
            href="https://github.com/settings/tokens/new?description=Skill%20Hub&scopes=repo"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-400 hover:text-indigo-300 underline"
          >
            在此创建 Token
          </a>{' '}
          — 需要 <code className="text-slate-400 bg-slate-950 px-1 rounded">repo</code> scope(或
          Fine-grained 的 Contents: Read & Write)。Token 会保存在 ~/.config/skill-hub/credentials.json
          (权限 600),仅本机可读。
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={async () => {
            const data = await submit('/api/sync/config')
            if (data?.ok) onConnected()
          }}
          disabled={submitting || !repoUrl || !token}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white transition-all shadow-lg shadow-indigo-600/20"
        >
          {submitting ? '验证中...' : '验证并保存'}
        </button>
        <button
          onClick={() => submit('/api/sync/validate')}
          disabled={submitting || !repoUrl || !token}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm text-slate-300 transition-all"
        >
          仅验证(不保存)
        </button>
      </div>
    </div>
  )
}

function ConnectedPanel({
  config,
  onDisconnect,
  onRevalidated,
}: {
  config: PublicSyncConfig
  onDisconnect: () => void
  onRevalidated: () => void
}) {
  const [busy, setBusy] = useState<'revalidate' | 'disconnect' | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const revalidate = async () => {
    setBusy('revalidate')
    setMsg(null)
    try {
      const res = await fetch('/api/sync/revalidate', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setMsg({ kind: 'ok', text: '仓库连接正常' })
        onRevalidated()
      } else {
        setMsg({ kind: 'err', text: data.error || '校验失败' })
      }
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async () => {
    if (!confirm('断开连接会删除本机保存的 Token。本地的 Skills 文件不受影响。继续?')) return
    setBusy('disconnect')
    try {
      await fetch('/api/sync/config', { method: 'DELETE' })
      onDisconnect()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-green-400 font-medium">已连接</span>
          </div>
          <div className="text-base text-slate-100 font-semibold">
            {config.owner}/{config.name}
          </div>
          <a
            href={config.repoUrl || '#'}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-indigo-400 hover:text-indigo-300 underline"
          >
            {config.repoUrl}
          </a>
        </div>
        <div className="text-right text-[11px] text-slate-500 space-y-0.5">
          <div>默认分支: <span className="text-slate-400">{config.defaultBranch}</span></div>
          {config.lastValidatedAt && (
            <div>上次验证: <span className="text-slate-400">{formatTime(config.lastValidatedAt)}</span></div>
          )}
        </div>
      </div>

      {msg && (
        <div
          className={`p-3 rounded-lg text-sm border ${
            msg.kind === 'ok'
              ? 'bg-green-500/10 border-green-500/20 text-green-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={revalidate}
          disabled={busy !== null}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-lg text-sm text-slate-300 transition-all"
        >
          {busy === 'revalidate' ? '验证中...' : '重新验证'}
        </button>
        <button
          onClick={disconnect}
          disabled={busy !== null}
          className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 disabled:opacity-40 rounded-lg text-sm text-red-400 transition-all"
        >
          {busy === 'disconnect' ? '断开中...' : '断开连接'}
        </button>
      </div>

      <UploadSection />
      <DownloadSection />
    </div>
  )
}

// ------------------------- Upload section -------------------------

interface ScanFinding {
  file: string
  line: number
  column: number
  match: string
  kind: string
  severity: 'danger' | 'warn'
}

interface UploadPreview {
  localSkillCount: number
  syncableSkillCount: number
  excludedSkillCount: number
  skillChanges: {
    agent: string
    name: string
    vaultDir: string
    status: 'add' | 'update' | 'delete' | 'unchanged'
    filesAdded: number
    filesUpdated: number
    filesDeleted: number
    filesUnchanged: number
  }[]
  totals: {
    skillsAdded: number
    skillsUpdated: number
    skillsDeleted: number
    skillsUnchanged: number
    filesAdded: number
    filesUpdated: number
    filesDeleted: number
  }
  scan: { totalFindings: number; danger: number; warn: number; findings: ScanFinding[] }
  skippedFiles: { relPath: string; reason: string }[]
}

function UploadSection() {
  const [preview, setPreview] = useState<UploadPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [allowSecrets, setAllowSecrets] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)

  const openPreview = async () => {
    setLoading(true)
    setError(null)
    setPreview(null)
    setAllowSecrets(false)
    setResultMsg(null)
    try {
      const res = await fetch('/api/sync/upload/preview', { method: 'POST' })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || '预览失败')
        return
      }
      setPreview(data.preview)
    } catch (e: any) {
      setError(e?.message || '预览失败')
    } finally {
      setLoading(false)
    }
  }

  const confirmUpload = async () => {
    setConfirming(true)
    setError(null)
    try {
      const res = await fetch('/api/sync/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowSecrets }),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || '上传失败')
        if (data.preview) setPreview(data.preview)
        return
      }
      setResultMsg(data.noop ? '没有需要上传的改动' : `上传成功 (${data.sha.slice(0, 7)})`)
      setPreview(null)
    } catch (e: any) {
      setError(e?.message || '上传失败')
    } finally {
      setConfirming(false)
    }
  }

  const t = preview?.totals
  const hasChanges = t ? t.skillsAdded + t.skillsUpdated + t.skillsDeleted > 0 : false
  const hasDanger = (preview?.scan.danger ?? 0) > 0

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-1">上传到 GitHub</h3>
          <p className="text-xs text-slate-500">
            把本机所有 Skill(自动排除 marketplace/plugin)备份到仓库。先预览再确认。
          </p>
        </div>
        <button
          onClick={openPreview}
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-sm font-medium text-white transition-all shadow-lg shadow-indigo-600/20"
        >
          {loading ? '预览中...' : '预览上传'}
        </button>
      </div>

      {resultMsg && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
          ✓ {resultMsg}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {preview && (
        <div className="space-y-3 pt-2">
          <div className="text-xs text-slate-400">
            本机共 <span className="text-slate-200 font-semibold">{preview.localSkillCount}</span> 个 Skill,
            其中{' '}
            <span className="text-slate-200 font-semibold">{preview.syncableSkillCount}</span> 个可同步,
            <span className="text-slate-600"> {preview.excludedSkillCount} 个已排除(marketplace/plugin)</span>。
          </div>

          {/* Totals */}
          <div className="grid grid-cols-4 gap-2">
            <Stat label="新增" value={t!.skillsAdded} color="green" />
            <Stat label="更新" value={t!.skillsUpdated} color="amber" />
            <Stat label="删除" value={t!.skillsDeleted} color="red" />
            <Stat label="未变" value={t!.skillsUnchanged} color="slate" />
          </div>

          {/* Secret scan */}
          {preview.scan.totalFindings > 0 && (
            <div
              className={`p-3 rounded-lg border text-xs ${
                hasDanger
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}
            >
              <div className="font-medium mb-1.5">
                {hasDanger ? '⚠ 检测到疑似密钥' : '注意'}(
                {preview.scan.danger} 个敏感 / {preview.scan.warn} 个警告)
              </div>
              <div className="max-h-32 overflow-y-auto space-y-0.5 font-mono text-[11px] leading-snug">
                {preview.scan.findings.slice(0, 20).map((f, i) => (
                  <div key={i} className="truncate">
                    <span className={f.severity === 'danger' ? 'text-red-400' : 'text-amber-400'}>
                      [{f.kind}]
                    </span>{' '}
                    <span className="text-slate-400">{f.file}:{f.line}</span>{' '}
                    <span className="text-slate-500">— {f.match}</span>
                  </div>
                ))}
                {preview.scan.findings.length > 20 && (
                  <div className="text-slate-500">...还有 {preview.scan.findings.length - 20} 条</div>
                )}
              </div>
              {hasDanger && (
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowSecrets}
                    onChange={(e) => setAllowSecrets(e.target.checked)}
                    className="w-3.5 h-3.5"
                  />
                  <span className="text-red-300">我已确认,这些是误报,继续上传</span>
                </label>
              )}
            </div>
          )}

          {/* Per-skill changes */}
          <div className="max-h-60 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800/60">
            {preview.skillChanges
              .filter((c) => c.status !== 'unchanged')
              .map((c, i) => (
                <div key={i} className="px-3 py-2 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusPill status={c.status} />
                    <span className="text-slate-300 truncate">{c.vaultDir}</span>
                  </div>
                  <div className="text-slate-500 text-[11px] shrink-0">
                    {c.filesAdded > 0 && <span className="text-green-400">+{c.filesAdded} </span>}
                    {c.filesUpdated > 0 && <span className="text-amber-400">~{c.filesUpdated} </span>}
                    {c.filesDeleted > 0 && <span className="text-red-400">-{c.filesDeleted}</span>}
                  </div>
                </div>
              ))}
            {!hasChanges && <div className="px-3 py-4 text-xs text-slate-500 text-center">仓库已是最新</div>}
          </div>

          {/* Confirm button */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={confirmUpload}
              disabled={confirming || (hasDanger && !allowSecrets) || !hasChanges}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white"
            >
              {confirming ? '上传中...' : hasChanges ? '确认上传' : '无变动'}
            </button>
            <button
              onClick={() => setPreview(null)}
              disabled={confirming}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-lg text-sm text-slate-300"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: 'green' | 'amber' | 'red' | 'slate' }) {
  const colors = {
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    slate: 'bg-slate-800/60 text-slate-400 border-slate-700',
  }
  return (
    <div className={`px-3 py-2 rounded-lg border ${colors[color]} text-center`}>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
    </div>
  )
}

// ------------------------- Download section -------------------------

type SkillState = 'remote_only' | 'local_only' | 'identical' | 'different'

interface SyncSkillRow {
  key: string
  agent: string
  name: string
  state: SkillState
  localPath: string | null
  localModifiedAt: string | null
  remoteModifiedAt: string | null
  filesInRemote: number
  filesInLocal: number
  filesDiffering: number
  excluded: boolean
  excludeReason: string | null
}

interface DownloadListing {
  vaultHead: string | null
  rows: SyncSkillRow[]
  totals: {
    remoteOnly: number
    localOnly: number
    identical: number
    different: number
    excluded: number
  }
}

type DownloadFilter = 'all' | 'remote_only' | 'different' | 'local_only'

function DownloadSection() {
  const [listing, setListing] = useState<DownloadListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<DownloadFilter>('all')
  const [applying, setApplying] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    setResultMsg(null)
    try {
      const res = await fetch('/api/sync/download/listing')
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || '加载失败')
        return
      }
      setListing(data.listing)
      setSelected(new Set())
    } catch (e: any) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const applySelected = async () => {
    setApplying(true)
    setError(null)
    try {
      const res = await fetch('/api/sync/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: Array.from(selected) }),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || '下载失败')
        return
      }
      setResultMsg(`已下载 ${data.applied.length} 个 skill`)
      setConfirmOpen(false)
      await refresh()
    } catch (e: any) {
      setError(e?.message || '下载失败')
    } finally {
      setApplying(false)
    }
  }

  const visibleRows = (listing?.rows || []).filter((r) => {
    if (filter === 'all') return true
    if (filter === 'remote_only') return r.state === 'remote_only'
    if (filter === 'different') return r.state === 'different'
    if (filter === 'local_only') return r.state === 'local_only'
    return true
  })

  const selectableRows = visibleRows.filter(
    (r) => !r.excluded && (r.state === 'remote_only' || r.state === 'different'),
  )

  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.key))

  const toggleAll = () => {
    const next = new Set(selected)
    if (allSelected) {
      for (const r of selectableRows) next.delete(r.key)
    } else {
      for (const r of selectableRows) next.add(r.key)
    }
    setSelected(next)
  }

  const toggleRow = (key: string) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
  }

  // Selected rows that would overwrite local content — used in confirm dialog
  const overwritingSelected = Array.from(selected)
    .map((k) => listing?.rows.find((r) => r.key === k))
    .filter((r): r is SyncSkillRow => !!r && r.state === 'different')

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-1">从 GitHub 下载</h3>
          <p className="text-xs text-slate-500">
            查看仓库里有哪些 skill,勾选要下载的项。下载会覆盖本地同名 skill 的内容。
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-lg text-sm text-slate-300"
        >
          {loading ? '加载中...' : listing ? '刷新列表' : '加载列表'}
        </button>
      </div>

      {resultMsg && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
          ✓ {resultMsg}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {listing && (
        <>
          {/* Totals */}
          <div className="grid grid-cols-4 gap-2">
            <Stat label="仅仓库" value={listing.totals.remoteOnly} color="green" />
            <Stat label="两边不同" value={listing.totals.different} color="amber" />
            <Stat label="仅本地" value={listing.totals.localOnly} color="slate" />
            <Stat label="两边一致" value={listing.totals.identical} color="slate" />
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 bg-slate-950 rounded-lg border border-slate-800 p-0.5 w-fit">
            {(
              [
                { value: 'all', label: '全部' },
                { value: 'remote_only', label: '仅新增' },
                { value: 'different', label: '有差异' },
                { value: 'local_only', label: '仅本地' },
              ] as { value: DownloadFilter; label: string }[]
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-3 py-1 rounded-md text-xs transition-all ${
                  filter === opt.value
                    ? 'bg-slate-700 text-slate-200 shadow-sm'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Select all + action */}
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-2 cursor-pointer text-slate-400">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={selectableRows.length === 0}
                className="w-3.5 h-3.5"
              />
              全选可下载 ({selectableRows.length})
            </label>
            <div className="text-slate-500">已选 {selected.size} 个</div>
          </div>

          {/* Table */}
          <div className="max-h-96 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800/60">
            {visibleRows.length === 0 ? (
              <div className="px-3 py-6 text-xs text-slate-500 text-center">无匹配项</div>
            ) : (
              visibleRows.map((row) => (
                <DownloadRow
                  key={row.key}
                  row={row}
                  checked={selected.has(row.key)}
                  onToggle={() => toggleRow(row.key)}
                />
              ))
            )}
          </div>

          {/* Action */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={applying || selected.size === 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white"
            >
              {applying ? '下载中...' : `下载选中的 ${selected.size} 个`}
            </button>
          </div>
        </>
      )}

      {/* Confirm dialog */}
      {confirmOpen && listing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-100">确认下载</h3>
            <p className="text-sm text-slate-400">
              即将下载 <span className="text-slate-200 font-semibold">{selected.size}</span> 个 skill 到本地。
            </p>
            {overwritingSelected.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                <div className="font-medium mb-1">⚠ 以下 {overwritingSelected.length} 个 skill 在本机有未上传的修改,会被覆盖:</div>
                <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                  {overwritingSelected.map((r) => (
                    <li key={r.key} className="truncate">
                      · {r.key}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={applySelected}
                disabled={applying}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-sm font-medium text-white"
              >
                {applying ? '下载中...' : '确认下载'}
              </button>
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={applying}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm text-slate-300"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DownloadRow({
  row,
  checked,
  onToggle,
}: {
  row: SyncSkillRow
  checked: boolean
  onToggle: () => void
}) {
  const selectable = !row.excluded && (row.state === 'remote_only' || row.state === 'different')
  return (
    <div
      className={`px-3 py-2 flex items-center gap-3 text-xs ${
        row.excluded || !selectable ? 'opacity-60' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={!selectable}
        className="w-3.5 h-3.5 shrink-0"
      />
      <StateBadge state={row.state} />
      <div className="flex-1 min-w-0">
        <div className="text-slate-300 truncate">{row.key}</div>
        {row.excluded && (
          <div className="text-[10px] text-slate-600">已排除 — {row.excludeReason}</div>
        )}
      </div>
      <div className="text-[10px] text-slate-600 shrink-0 text-right space-y-0.5">
        {row.state === 'different' && (
          <div className="text-amber-400/80">{row.filesDiffering} 个文件不同</div>
        )}
        {row.remoteModifiedAt && (
          <div>仓库: {formatShort(row.remoteModifiedAt)}</div>
        )}
        {row.localModifiedAt && <div>本地: {formatShort(row.localModifiedAt)}</div>}
      </div>
    </div>
  )
}

function StateBadge({ state }: { state: SkillState }) {
  const map: Record<SkillState, { label: string; cls: string }> = {
    remote_only: { label: '🆕 新增', cls: 'bg-green-500/15 text-green-400' },
    different: { label: '⚠ 不同', cls: 'bg-amber-500/15 text-amber-400' },
    local_only: { label: '📤 仅本地', cls: 'bg-slate-700/40 text-slate-400' },
    identical: { label: '✓ 一致', cls: 'bg-slate-800/60 text-slate-500' },
  }
  const m = map[state]
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium shrink-0 whitespace-nowrap ${m.cls}`}
    >
      {m.label}
    </span>
  )
}

function formatShort(iso: string): string {
  try {
    const d = new Date(iso)
    const now = Date.now()
    const diffMs = now - d.getTime()
    const h = Math.floor(diffMs / 3600_000)
    if (h < 1) return `${Math.floor(diffMs / 60_000)} 分钟前`
    if (h < 24) return `${h} 小时前`
    const days = Math.floor(h / 24)
    if (days < 30) return `${days} 天前`
    return d.toISOString().slice(0, 10)
  } catch {
    return iso
  }
}

function StatusPill({ status }: { status: 'add' | 'update' | 'delete' | 'unchanged' }) {
  const map = {
    add: { label: '新增', cls: 'bg-green-500/15 text-green-400' },
    update: { label: '更新', cls: 'bg-amber-500/15 text-amber-400' },
    delete: { label: '删除', cls: 'bg-red-500/15 text-red-400' },
    unchanged: { label: '未变', cls: 'bg-slate-700/40 text-slate-400' },
  }
  const m = map[status]
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${m.cls}`}>
      {m.label}
    </span>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}
