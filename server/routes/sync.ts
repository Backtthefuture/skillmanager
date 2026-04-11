import type { FastifyInstance } from 'fastify'
import {
  readConfig,
  writeConfig,
  deleteConfig,
  toPublic,
  parseRepoUrl,
  type SyncConfig,
} from '../sync/config.js'
import { validateRepo } from '../sync/github.js'
import { ensureVault, getVaultStatus } from '../sync/vault.js'
import { previewUpload, executeUpload } from '../sync/upload.js'
import { computeDownloadListing, applyDownload } from '../sync/download.js'
import { buildExportTarball } from '../sync/export.js'
import { fullScan } from '../scanner/discovery.js'
import { getCachedResult, invalidateCache } from './skills.js'

export async function syncRoutes(app: FastifyInstance) {
  // Get current config (redacted — never returns the token)
  app.get('/api/sync/config', async () => {
    const config = await readConfig()
    return toPublic(config)
  })

  // Validate a repo URL + token pair without persisting
  app.post<{ Body: { repoUrl?: string; token?: string } }>('/api/sync/validate', async (req, reply) => {
    const { repoUrl, token } = req.body || {}
    if (!repoUrl || !token) {
      return reply.status(400).send({ ok: false, error: '仓库地址和 Token 都是必填项' })
    }
    const parsed = parseRepoUrl(repoUrl)
    if (!parsed) {
      return reply
        .status(400)
        .send({ ok: false, error: '无法识别仓库地址。支持 https://github.com/owner/repo 或 owner/repo 格式。' })
    }
    const result = await validateRepo(parsed.owner, parsed.name, token)
    if (!result.ok) {
      return { ok: false, reason: result.reason, error: result.message }
    }
    return {
      ok: true,
      owner: parsed.owner,
      name: parsed.name,
      fullName: result.repo.fullName,
      defaultBranch: result.repo.defaultBranch,
      private: result.repo.private,
      htmlUrl: result.repo.htmlUrl,
    }
  })

  // Save config (validates first — bad credentials never get written)
  app.post<{ Body: { repoUrl?: string; token?: string } }>('/api/sync/config', async (req, reply) => {
    const { repoUrl, token } = req.body || {}
    if (!repoUrl || !token) {
      return reply.status(400).send({ ok: false, error: '仓库地址和 Token 都是必填项' })
    }
    const parsed = parseRepoUrl(repoUrl)
    if (!parsed) {
      return reply.status(400).send({ ok: false, error: '无法识别仓库地址' })
    }
    const result = await validateRepo(parsed.owner, parsed.name, token)
    if (!result.ok) {
      return reply.status(400).send({ ok: false, reason: result.reason, error: result.message })
    }

    const config: SyncConfig = {
      repoUrl: `https://github.com/${parsed.owner}/${parsed.name}`,
      owner: parsed.owner,
      name: parsed.name,
      defaultBranch: result.repo.defaultBranch,
      token,
      lastValidatedAt: new Date().toISOString(),
    }
    await writeConfig(config)
    return { ok: true, config: toPublic(config) }
  })

  // Disconnect — remove config
  app.delete('/api/sync/config', async () => {
    await deleteConfig()
    return { ok: true }
  })

  // Vault status — returns current clone state (file count, HEAD, last fetch)
  app.get('/api/sync/vault/status', async (_req, reply) => {
    const config = await readConfig()
    if (!config) {
      return reply.status(400).send({ ok: false, error: '尚未配置同步仓库' })
    }
    const status = await getVaultStatus(config)
    return { ok: true, status }
  })

  // Vault init / refresh — clones if missing, fetches otherwise. Idempotent.
  app.post('/api/sync/vault/init', async (_req, reply) => {
    const config = await readConfig()
    if (!config) {
      return reply.status(400).send({ ok: false, error: '尚未配置同步仓库' })
    }
    const result = await ensureVault(config)
    if (!result.ok) {
      return reply.status(500).send({ ok: false, error: result.error })
    }
    return { ok: true, status: result.status }
  })

  // Upload preview — computes diff and secret scan, no writes
  app.post('/api/sync/upload/preview', async (_req, reply) => {
    const config = await readConfig()
    if (!config) return reply.status(400).send({ ok: false, error: '尚未配置同步仓库' })

    // Use cached scan if fresh, otherwise do a full scan
    let scan = getCachedResult()
    if (!scan) scan = await fullScan()

    const result = await previewUpload(config, scan.skills)
    if (!result.ok) return reply.status(500).send({ ok: false, error: result.error })
    return { ok: true, preview: result.preview }
  })

  // Upload execute — materializes vault, commits, pushes
  app.post<{ Body: { allowSecrets?: boolean } }>('/api/sync/upload', async (req, reply) => {
    const config = await readConfig()
    if (!config) return reply.status(400).send({ ok: false, error: '尚未配置同步仓库' })

    // Always re-scan for the execute path — don't trust stale cache for writes
    const scan = await fullScan()
    const allowSecrets = Boolean(req.body?.allowSecrets)

    const result = await executeUpload(config, scan.skills, { allowSecrets })
    if (!result.ok) {
      return reply.status(400).send({ ok: false, error: result.error, preview: result.preview })
    }
    return { ok: true, sha: result.sha, noop: result.noop, preview: result.preview }
  })

  // Download listing — 4-state table
  app.get('/api/sync/download/listing', async (_req, reply) => {
    const config = await readConfig()
    if (!config) return reply.status(400).send({ ok: false, error: '尚未配置同步仓库' })

    let scan = getCachedResult()
    if (!scan) scan = await fullScan()

    const result = await computeDownloadListing(config, scan.skills)
    if (!result.ok) return reply.status(500).send({ ok: false, error: result.error })
    return { ok: true, listing: result.listing }
  })

  // Download apply — copy selected skills from vault into local agent dirs
  app.post<{ Body: { keys?: string[] } }>('/api/sync/download', async (req, reply) => {
    const config = await readConfig()
    if (!config) return reply.status(400).send({ ok: false, error: '尚未配置同步仓库' })

    const keys = req.body?.keys || []
    if (!Array.isArray(keys) || keys.length === 0) {
      return reply.status(400).send({ ok: false, error: '未选择要下载的 Skill' })
    }
    // Sanitize: each key must match `<agent>/<name>` with no traversal
    for (const k of keys) {
      if (typeof k !== 'string' || k.includes('..') || k.includes('\\') || k.split('/').length !== 2) {
        return reply.status(400).send({ ok: false, error: `非法 key: ${k}` })
      }
    }

    const result = await applyDownload(config, keys)
    if (!result.ok) return reply.status(500).send({ ok: false, error: result.error })
    // Scanner cache is now stale — next scan request will re-read disk
    invalidateCache()
    return { ok: true, applied: result.applied }
  })

  // Export — packages all syncable skills into a tar.gz. No GitHub needed.
  app.get('/api/sync/export/tar', async (_req, reply) => {
    let scan = getCachedResult()
    if (!scan) scan = await fullScan()

    const result = await buildExportTarball(scan.skills)
    if (!result.ok) {
      return reply.status(500).send({ ok: false, error: result.error })
    }
    reply
      .header('Content-Type', 'application/gzip')
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .header('X-Skill-Count', String(result.skillCount))
      .header('X-File-Count', String(result.fileCount))
      .header('X-Excluded-Count', String(result.excludedCount))
    return reply.send(result.buffer)
  })

  // Re-validate stored config (used by "refresh" button)
  app.post('/api/sync/revalidate', async (_req, reply) => {
    const config = await readConfig()
    if (!config) {
      return reply.status(400).send({ ok: false, error: '尚未配置同步仓库' })
    }
    const result = await validateRepo(config.owner, config.name, config.token)
    if (!result.ok) {
      return { ok: false, reason: result.reason, error: result.message }
    }
    const updated: SyncConfig = {
      ...config,
      defaultBranch: result.repo.defaultBranch,
      lastValidatedAt: new Date().toISOString(),
    }
    await writeConfig(updated)
    return { ok: true, config: toPublic(updated) }
  })
}
