import type { FastifyInstance } from 'fastify'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { invalidateCache } from './skills.js'
import { createSnapshot } from '../versioning/store.js'
import { moveToTrash } from '../trash/store.js'
import { confinePath, confineExistingPath } from '../security.js'

const homedir = os.homedir()
const settingsPath = path.join(homedir, '.claude', 'settings.json')

// skillName is user-supplied and gets joined into a filesystem path. Reject
// anything that could escape the intended parent dir (separators, traversal,
// NUL bytes, Windows drive letters). Also cap length — npm/git barf past this.
function sanitizeSkillName(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('skillName 必须是字符串')
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error('skillName 不能为空')
  if (trimmed.length > 128) throw new Error('skillName 过长')
  if (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0') ||
    trimmed === '.' ||
    trimmed === '..' ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    throw new Error(`skillName 包含非法字符: ${raw}`)
  }
  return trimmed
}

async function readSettings(): Promise<any> {
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function writeSettings(settings: any): Promise<void> {
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
}

export async function manageRoutes(app: FastifyInstance) {
  // Toggle skill enabled/disabled
  app.put<{
    Params: { id: string }
    Body: { enabled: boolean; skillName: string }
  }>('/api/skills/:id/toggle', async (req) => {
    const { enabled, skillName } = req.body
    const settings = await readSettings()

    if (!settings.permissions) settings.permissions = {}
    if (!settings.permissions.deny) settings.permissions.deny = []

    const rule = `Skill(${skillName})`
    const idx = settings.permissions.deny.indexOf(rule)

    if (enabled && idx >= 0) {
      // Remove from deny list to enable
      settings.permissions.deny.splice(idx, 1)
    } else if (!enabled && idx < 0) {
      // Add to deny list to disable
      settings.permissions.deny.push(rule)
    }

    await writeSettings(settings)
    invalidateCache()
    return { ok: true, enabled }
  })

  // Update SKILL.md content
  app.put<{
    Params: { id: string }
    Body: { realPath: string; content: string }
  }>('/api/skills/:id/content', async (req, reply) => {
    const { realPath, content } = req.body
    if (typeof content !== 'string') {
      reply.status(400)
      return { ok: false, error: 'content 必须是字符串' }
    }

    let safeRealPath: string
    try {
      safeRealPath = await confineExistingPath(realPath)
    } catch (err: any) {
      reply.status(403)
      return { ok: false, error: err?.message || '路径不合法' }
    }

    const skillMdPath = path.join(safeRealPath, 'SKILL.md')
    try {
      await fs.access(skillMdPath)
    } catch {
      reply.status(404)
      return { ok: false, error: 'SKILL.md not found' }
    }

    // Auto-snapshot before overwriting (save the old version)
    const skillName = path.basename(safeRealPath)
    try {
      await createSnapshot(safeRealPath, skillName, '编辑前自动备份', 'auto')
    } catch {}

    await fs.writeFile(skillMdPath, content, 'utf-8')

    // Snapshot the new version
    try {
      await createSnapshot(safeRealPath, skillName, '通过编辑器保存', 'auto')
    } catch {}

    invalidateCache()
    return { ok: true }
  })

  // Copy skill to another location
  app.post<{
    Body: {
      sourcePath: string
      targetScope: 'global' | 'project'
      projectPath?: string
      skillName: string
    }
  }>('/api/skills/copy', async (req, reply) => {
    const { sourcePath, targetScope, projectPath, skillName } = req.body

    let safeName: string
    let safeSource: string
    let targetDir: string
    try {
      safeName = sanitizeSkillName(skillName)
      safeSource = await confineExistingPath(sourcePath)

      if (targetScope === 'global') {
        targetDir = path.join(homedir, '.claude', 'skills', safeName)
      } else if (projectPath) {
        const safeProject = await confineExistingPath(projectPath)
        targetDir = path.join(safeProject, '.claude', 'skills', safeName)
      } else {
        reply.status(400)
        return { ok: false, error: 'Project path required for project scope' }
      }
      // Target itself must also fall inside a safe root.
      targetDir = await confinePath(targetDir)
    } catch (err: any) {
      reply.status(403)
      return { ok: false, error: err?.message || '参数不合法' }
    }

    try {
      await fs.access(targetDir)
      return { ok: false, error: '目标位置已存在同名 Skill' }
    } catch {
      // Good — doesn't exist
    }

    await copyDir(safeSource, targetDir)
    invalidateCache()
    return { ok: true, targetDir }
  })

  // Move skill (copy + delete source)
  app.post<{
    Body: {
      sourcePath: string
      targetScope: 'global' | 'project'
      projectPath?: string
      skillName: string
    }
  }>('/api/skills/move', async (req, reply) => {
    const { sourcePath, targetScope, projectPath, skillName } = req.body

    let safeName: string
    let safeSourceReal: string
    let safeSourceLink: string
    let targetDir: string
    try {
      safeName = sanitizeSkillName(skillName)
      // Validate both the link location AND the symlink target; both get
      // touched (source link is unlinked, real dir is copied).
      safeSourceLink = await confineExistingPath(sourcePath)
      safeSourceReal = await confineExistingPath(
        await fs.realpath(safeSourceLink).catch(() => safeSourceLink),
      )

      if (targetScope === 'global') {
        targetDir = path.join(homedir, '.claude', 'skills', safeName)
      } else if (projectPath) {
        const safeProject = await confineExistingPath(projectPath)
        targetDir = path.join(safeProject, '.claude', 'skills', safeName)
      } else {
        reply.status(400)
        return { ok: false, error: 'Project path required for project scope' }
      }
      targetDir = await confinePath(targetDir)
    } catch (err: any) {
      reply.status(403)
      return { ok: false, error: err?.message || '参数不合法' }
    }

    try {
      await fs.access(targetDir)
      return { ok: false, error: '目标位置已存在同名 Skill' }
    } catch {}

    await copyDir(safeSourceReal, targetDir)

    // Remove the source (if symlink, just remove the link; if dir, remove recursively)
    const stat = await fs.lstat(safeSourceLink)
    if (stat.isSymbolicLink()) {
      await fs.unlink(safeSourceLink)
    } else {
      await fs.rm(safeSourceLink, { recursive: true })
    }

    invalidateCache()
    return { ok: true, targetDir }
  })

  // Delete skill (soft delete → recycle bin; 7-day TTL)
  app.delete<{
    Params: { id: string }
    Body: { path: string; skillName?: string }
  }>('/api/skills/:id', async (req, reply) => {
    const skillName = req.body.skillName

    let safePath: string
    try {
      safePath = await confineExistingPath(req.body.path)
    } catch (err: any) {
      reply.status(403)
      return { ok: false, error: err?.message || '路径不合法' }
    }

    try {
      const meta = await moveToTrash(safePath, skillName)
      invalidateCache()
      return { ok: true, trashId: meta.id, expiresAt: meta.expiresAt }
    } catch (err: any) {
      reply.status(500)
      return { ok: false, error: err?.message || '删除失败' }
    }
  })

  // Batch delete — move many skills to trash in one call
  app.post<{
    Body: { items: { id: string; path: string; skillName?: string }[] }
  }>('/api/skills/batch/delete', async (req, reply) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (items.length === 0) {
      reply.status(400)
      return { ok: false, error: '未提供要删除的 skill' }
    }

    const results: {
      id: string
      skillName?: string
      ok: boolean
      trashId?: string
      error?: string
    }[] = []

    for (const item of items) {
      if (!item || typeof item.path !== 'string') {
        results.push({ id: item?.id || '(unknown)', ok: false, error: '参数不完整' })
        continue
      }
      let safeItemPath: string
      try {
        safeItemPath = await confineExistingPath(item.path)
      } catch (err: any) {
        results.push({
          id: item.id,
          skillName: item.skillName,
          ok: false,
          error: err?.message || '路径不合法',
        })
        continue
      }
      try {
        const meta = await moveToTrash(safeItemPath, item.skillName)
        results.push({
          id: item.id,
          skillName: item.skillName,
          ok: true,
          trashId: meta.id,
        })
      } catch (err: any) {
        results.push({
          id: item.id,
          skillName: item.skillName,
          ok: false,
          error: err?.message || '删除失败',
        })
      }
    }

    invalidateCache()

    const okCount = results.filter((r) => r.ok).length
    const failCount = results.length - okCount
    return { ok: failCount === 0, okCount, failCount, results }
  })
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}
