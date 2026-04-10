/**
 * Skill Trash (Recycle Bin)
 *
 * 设计：软删除 → ~/.skill-hub/trash/<id>/
 *   - 普通目录：整个 skill 目录被 rename 进 trash/<id>/payload/
 *   - 符号链接：不搬运实际文件，只在 meta 里记录 target，还原时重建 symlink
 *   - meta: trash/<id>/.trash-meta.json
 *   - 过期策略：7 天 TTL，懒清理（列表接口和启动时触发 purge）
 */
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

const TRASH_ROOT = path.join(os.homedir(), '.skill-hub', 'trash')
export const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface TrashMeta {
  id: string
  skillName: string
  originalPath: string        // 被删除前的路径（含 symlink 的链接位置）
  scope: 'global' | 'project' | 'unknown'
  projectPath?: string        // 如果是项目 skill，记录项目根
  isSymlink: boolean
  symlinkTarget?: string      // 仅当 isSymlink
  deletedAt: string           // ISO
  expiresAt: string           // ISO
  sizeBytes?: number
}

export interface TrashEntry extends TrashMeta {
  daysRemaining: number
}

function newId(): string {
  const now = Date.now().toString(36)
  const rand = crypto.randomBytes(4).toString('hex')
  return `${now}-${rand}`
}

async function ensureRoot(): Promise<void> {
  await fs.mkdir(TRASH_ROOT, { recursive: true })
}

function entryDir(id: string): string {
  return path.join(TRASH_ROOT, id)
}

function metaPath(id: string): string {
  return path.join(entryDir(id), '.trash-meta.json')
}

function payloadPath(id: string): string {
  return path.join(entryDir(id), 'payload')
}

async function readMeta(id: string): Promise<TrashMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(id), 'utf-8')
    return JSON.parse(raw) as TrashMeta
  } catch {
    return null
  }
}

async function writeMeta(meta: TrashMeta): Promise<void> {
  await fs.writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf-8')
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        total += await dirSize(full)
      } else if (e.isFile()) {
        try {
          const st = await fs.stat(full)
          total += st.size
        } catch {}
      }
    }
  } catch {}
  return total
}

function inferScope(skillPath: string): { scope: TrashMeta['scope']; projectPath?: string } {
  const home = os.homedir()
  const globalRoot = path.join(home, '.claude', 'skills')
  if (skillPath.startsWith(globalRoot + path.sep) || skillPath === globalRoot) {
    return { scope: 'global' }
  }
  // Project skills live at <project>/.claude/skills/<name>
  const marker = path.sep + '.claude' + path.sep + 'skills' + path.sep
  const idx = skillPath.indexOf(marker)
  if (idx >= 0) {
    return { scope: 'project', projectPath: skillPath.slice(0, idx) }
  }
  return { scope: 'unknown' }
}

/**
 * 将 skill 移入回收站。返回 trash 条目元信息。
 */
export async function moveToTrash(skillPath: string, skillName?: string): Promise<TrashMeta> {
  await ensureRoot()

  const stat = await fs.lstat(skillPath)
  const id = newId()
  const dir = entryDir(id)
  await fs.mkdir(dir, { recursive: true })

  const now = new Date()
  const expires = new Date(now.getTime() + TRASH_TTL_MS)
  const { scope, projectPath } = inferScope(skillPath)
  const name = skillName || path.basename(skillPath)

  if (stat.isSymbolicLink()) {
    const target = await fs.readlink(skillPath)
    // 先写 meta，成功后再 unlink 原链接，避免中途失败丢信息
    const meta: TrashMeta = {
      id,
      skillName: name,
      originalPath: skillPath,
      scope,
      projectPath,
      isSymlink: true,
      symlinkTarget: target,
      deletedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    }
    await writeMeta(meta)
    await fs.unlink(skillPath)
    return meta
  }

  // 普通目录：rename 到 payload/。同盘 rename 是原子操作，跨盘会失败 → 回退到 cp+rm
  const dest = payloadPath(id)
  try {
    await fs.rename(skillPath, dest)
  } catch (err: any) {
    if (err?.code === 'EXDEV') {
      await copyDir(skillPath, dest)
      await fs.rm(skillPath, { recursive: true })
    } else {
      throw err
    }
  }

  const size = await dirSize(dest).catch(() => 0)
  const meta: TrashMeta = {
    id,
    skillName: name,
    originalPath: skillPath,
    scope,
    projectPath,
    isSymlink: false,
    deletedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    sizeBytes: size,
  }
  await writeMeta(meta)
  return meta
}

/**
 * 列出回收站条目（顺便触发过期清理）
 */
export async function listTrash(): Promise<TrashEntry[]> {
  await ensureRoot()
  await purgeExpired()

  const entries: TrashEntry[] = []
  let dirs: string[] = []
  try {
    dirs = await fs.readdir(TRASH_ROOT)
  } catch {
    return entries
  }

  const nowMs = Date.now()
  for (const id of dirs) {
    const meta = await readMeta(id)
    if (!meta) continue
    const expiresMs = new Date(meta.expiresAt).getTime()
    const daysRemaining = Math.max(0, Math.ceil((expiresMs - nowMs) / (24 * 60 * 60 * 1000)))
    entries.push({ ...meta, daysRemaining })
  }

  entries.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime())
  return entries
}

/**
 * 还原一个条目到原位置。
 * - 若目标已存在且 force=false → 抛 TrashConflictError
 * - 若 force=true → 先把目标移进新 trash 条目（保底），再还原
 */
export class TrashConflictError extends Error {
  constructor(public targetPath: string) {
    super(`目标位置已存在：${targetPath}`)
    this.name = 'TrashConflictError'
  }
}

export class TrashNotFoundError extends Error {
  constructor(id: string) {
    super(`回收站条目不存在：${id}`)
    this.name = 'TrashNotFoundError'
  }
}

export async function restoreFromTrash(id: string, force = false): Promise<TrashMeta> {
  const meta = await readMeta(id)
  if (!meta) throw new TrashNotFoundError(id)

  // 检查目标路径冲突
  let targetExists = false
  try {
    await fs.lstat(meta.originalPath)
    targetExists = true
  } catch {}

  if (targetExists) {
    if (!force) throw new TrashConflictError(meta.originalPath)
    // force：把目标先扔进回收站作为保底
    await moveToTrash(meta.originalPath, meta.skillName)
  }

  // 确保父目录存在
  await fs.mkdir(path.dirname(meta.originalPath), { recursive: true })

  if (meta.isSymlink && meta.symlinkTarget) {
    await fs.symlink(meta.symlinkTarget, meta.originalPath)
  } else {
    const src = payloadPath(id)
    try {
      await fs.rename(src, meta.originalPath)
    } catch (err: any) {
      if (err?.code === 'EXDEV') {
        await copyDir(src, meta.originalPath)
        await fs.rm(src, { recursive: true })
      } else {
        throw err
      }
    }
  }

  // 清理 trash 条目目录
  await fs.rm(entryDir(id), { recursive: true, force: true })
  return meta
}

/**
 * 永久删除一个条目
 */
export async function purgeOne(id: string): Promise<boolean> {
  const dir = entryDir(id)
  try {
    await fs.rm(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/**
 * 扫描并删除所有已过期条目
 */
export async function purgeExpired(): Promise<number> {
  await ensureRoot()
  let dirs: string[] = []
  try {
    dirs = await fs.readdir(TRASH_ROOT)
  } catch {
    return 0
  }
  const now = Date.now()
  let removed = 0
  for (const id of dirs) {
    const meta = await readMeta(id)
    if (!meta) {
      // 坏掉的条目（没 meta）直接清理
      await fs.rm(entryDir(id), { recursive: true, force: true }).catch(() => {})
      continue
    }
    if (new Date(meta.expiresAt).getTime() <= now) {
      await fs.rm(entryDir(id), { recursive: true, force: true }).catch(() => {})
      removed++
    }
  }
  return removed
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isSymbolicLink()) {
      const target = await fs.readlink(s)
      await fs.symlink(target, d)
    } else if (entry.isDirectory()) {
      await copyDir(s, d)
    } else if (entry.isFile()) {
      await fs.copyFile(s, d)
    }
  }
}
