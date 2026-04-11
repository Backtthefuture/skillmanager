import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import type { Skill } from '../types.js'
import type { SyncConfig } from './config.js'
import { ensureVault, vaultDirFor, listVaultFiles, readVaultFile } from './vault.js'
import { isSyncableSkill, materializeSkill, vaultDirForSkill } from './layout.js'

/**
 * Download-side diff computation.
 *
 * A "skill" in the vault is any directory that contains a SKILL.md file at
 * depth 2 (i.e. <agent>/<name>/SKILL.md). We aggregate files under each such
 * directory into a "remote skill" and compare content hashes with the
 * corresponding local skill.
 *
 * The UI uses 4 states per skill:
 *   - remote_only:  exists in vault, not locally
 *   - local_only:   exists locally, not in vault (user hasn't uploaded)
 *   - identical:    both sides present, same content
 *   - different:    both sides present, different content
 */

export type SkillState = 'remote_only' | 'local_only' | 'identical' | 'different'

export interface SyncSkillRow {
  key: string                 // "<agent>/<name>"
  agent: string
  name: string
  state: SkillState
  localPath: string | null    // absolute path on disk, if local exists
  localModifiedAt: string | null
  remoteModifiedAt: string | null  // vault file mtime
  filesInRemote: number
  filesInLocal: number
  filesDiffering: number       // for `different` state
  excluded: boolean            // marketplace/plugin — shown greyed out
  excludeReason: string | null
}

export interface DownloadListing {
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

function sha1(content: string | Buffer): string {
  return crypto.createHash('sha1').update(content).digest('hex')
}

/**
 * Walk the vault and group files by `<agent>/<name>/`.
 */
async function readRemoteSkills(vaultPath: string): Promise<Map<string, { files: Map<string, string>; latestMtime: number }>> {
  const remote = new Map<string, { files: Map<string, string>; latestMtime: number }>()
  const files = await listVaultFiles(vaultPath)
  for (const rel of files) {
    if (rel === '.gitignore') continue
    if (rel.startsWith('.skillhub/')) continue
    const parts = rel.split('/')
    if (parts.length < 3) continue // need at least <agent>/<name>/<file>
    const key = `${parts[0]}/${parts[1]}`
    const within = parts.slice(2).join('/')
    const content = await readVaultFile(vaultPath, rel)
    if (content == null) continue
    let entry = remote.get(key)
    if (!entry) {
      entry = { files: new Map(), latestMtime: 0 }
      remote.set(key, entry)
    }
    entry.files.set(within, sha1(content))
    try {
      const st = await fs.stat(path.join(vaultPath, rel))
      if (st.mtimeMs > entry.latestMtime) entry.latestMtime = st.mtimeMs
    } catch {}
  }
  // Only keep directories that actually contain SKILL.md — otherwise it's
  // loose files and we don't know how to materialize them as a "skill".
  for (const [key, info] of remote) {
    if (!info.files.has('SKILL.md')) remote.delete(key)
  }
  return remote
}

/**
 * Compute the download listing. Pulls latest from remote first.
 */
export async function computeDownloadListing(
  config: SyncConfig,
  skills: Skill[],
): Promise<{ ok: true; listing: DownloadListing } | { ok: false; error: string }> {
  const ensured = await ensureVault(config)
  if (!ensured.ok) return { ok: false, error: ensured.error }

  const vaultPath = vaultDirFor(config)
  const remoteSkills = await readRemoteSkills(vaultPath)

  // Build local skill map keyed the same way as vault dirs
  const localByKey = new Map<
    string,
    { skill: Skill; files: Map<string, string>; latestMtime: number; excluded: boolean; excludeReason: string | null }
  >()

  for (const skill of skills) {
    const excluded = !isSyncableSkill(skill)
    const excludeReason = excluded
      ? skill.scope === 'plugin'
        ? 'Plugin / marketplace skill'
        : skill.source === 'newmax' || skill.source === 'agents'
          ? '框架安装的 skill'
          : skill.agent === 'unknown'
            ? 'Agent 未识别'
            : 'unknown'
      : null

    // Even excluded skills get an entry so the UI can show them greyed out
    const key = vaultDirForSkill(skill)
    const localFiles = new Map<string, string>()
    let latestMtime = 0

    if (!excluded) {
      const { files } = await materializeSkill(skill)
      for (const f of files) {
        const within = f.relPath.slice(key.length + 1)
        // Hash is already computed during materialize
        localFiles.set(within, f.sha)
        try {
          const st = await fs.stat(f.absSource)
          if (st.mtimeMs > latestMtime) latestMtime = st.mtimeMs
        } catch {}
      }
    }

    localByKey.set(key, {
      skill,
      files: localFiles,
      latestMtime,
      excluded,
      excludeReason,
    })
  }

  // Build rows: union of keys
  const allKeys = new Set<string>([...remoteSkills.keys(), ...localByKey.keys()])
  const rows: SyncSkillRow[] = []

  for (const key of allKeys) {
    const [agent, ...nameParts] = key.split('/')
    const name = nameParts.join('/')
    const local = localByKey.get(key)
    const remote = remoteSkills.get(key)

    let state: SkillState
    let filesDiffering = 0

    if (!remote && local) {
      state = 'local_only'
    } else if (remote && !local) {
      state = 'remote_only'
    } else if (remote && local) {
      // Compare file sets
      const diffFiles = new Set<string>()
      for (const [f, hash] of local.files) {
        if (remote.files.get(f) !== hash) diffFiles.add(f)
      }
      for (const [f, hash] of remote.files) {
        if (local.files.get(f) !== hash) diffFiles.add(f)
      }
      filesDiffering = diffFiles.size
      state = filesDiffering === 0 ? 'identical' : 'different'
    } else {
      continue
    }

    rows.push({
      key,
      agent: agent || 'unknown',
      name: name || '(unnamed)',
      state,
      localPath: local?.skill.realPath || null,
      localModifiedAt: local && local.latestMtime > 0 ? new Date(local.latestMtime).toISOString() : null,
      remoteModifiedAt: remote && remote.latestMtime > 0 ? new Date(remote.latestMtime).toISOString() : null,
      filesInRemote: remote?.files.size || 0,
      filesInLocal: local?.files.size || 0,
      filesDiffering,
      excluded: local?.excluded ?? false,
      excludeReason: local?.excludeReason ?? null,
    })
  }

  // Sort: different first, then remote_only, then local_only, then identical
  const order: Record<SkillState, number> = {
    different: 0,
    remote_only: 1,
    local_only: 2,
    identical: 3,
  }
  rows.sort((a, b) => {
    const oa = order[a.state]
    const ob = order[b.state]
    if (oa !== ob) return oa - ob
    return a.key.localeCompare(b.key)
  })

  const totals = {
    remoteOnly: rows.filter((r) => r.state === 'remote_only').length,
    localOnly: rows.filter((r) => r.state === 'local_only' && !r.excluded).length,
    identical: rows.filter((r) => r.state === 'identical').length,
    different: rows.filter((r) => r.state === 'different').length,
    excluded: rows.filter((r) => r.excluded).length,
  }

  // Vault HEAD for display
  let vaultHead: string | null = null
  try {
    const { runGit } = await import('./vault.js')
    const res = await runGit(['rev-parse', 'HEAD'], { cwd: vaultPath })
    if (res.code === 0) vaultHead = res.stdout.trim()
  } catch {}

  return { ok: true, listing: { vaultHead, rows, totals } }
}

/**
 * Target dir where a remote skill should be written locally. Uses the same
 * agent → path map as the scanner, picking the first global path for each
 * agent (or a sensible default for universal).
 */
function localTargetDir(agent: string, name: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  // This mirrors server/scanner/agents.ts's global paths. Keep in sync manually.
  const agentHomePath: Record<string, string> = {
    'claude-code': '.claude/skills',
    codex: '.codex/skills',
    antigravity: '.gemini/antigravity/skills',
    augment: '.augment/skills',
    bob: '.bob/skills',
    openclaw: '.openclaw/skills',
    codebuddy: '.codebuddy/skills',
    universal: '.agents/skills',
  }
  const agentDir = agentHomePath[agent] || '.claude/skills'
  return path.join(home, agentDir, name)
}

/**
 * Apply selected rows: copy each remote skill's files into the local target
 * directory. Overwrites existing files in the skill dir. Does NOT touch other
 * skills or other agents.
 */
export async function applyDownload(
  config: SyncConfig,
  selectedKeys: string[],
): Promise<
  | { ok: true; applied: { key: string; files: number; targetDir: string }[] }
  | { ok: false; error: string }
> {
  const ensured = await ensureVault(config)
  if (!ensured.ok) return { ok: false, error: ensured.error }
  const vaultPath = vaultDirFor(config)

  const applied: { key: string; files: number; targetDir: string }[] = []

  for (const key of selectedKeys) {
    const [agent, ...nameParts] = key.split('/')
    const name = nameParts.join('/')
    if (!agent || !name) continue
    const targetDir = localTargetDir(agent, name)

    // Read every file for this skill from the vault
    const allFiles = await listVaultFiles(vaultPath)
    const prefix = `${key}/`
    const skillFiles = allFiles.filter((f) => f.startsWith(prefix))
    if (skillFiles.length === 0) continue

    // Ensure target dir exists
    await fs.mkdir(targetDir, { recursive: true })

    // Clear existing skill dir contents (user chose to overwrite). Don't
    // delete the directory itself — preserves perms/symlinks to the dir.
    try {
      const existing = await fs.readdir(targetDir)
      for (const entry of existing) {
        await fs.rm(path.join(targetDir, entry), { recursive: true, force: true })
      }
    } catch {}

    let written = 0
    for (const rel of skillFiles) {
      const within = rel.slice(prefix.length)
      const content = await fs.readFile(path.join(vaultPath, rel))
      const dest = path.join(targetDir, within)
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, content)
      written++
    }
    applied.push({ key, files: written, targetDir })
  }

  return { ok: true, applied }
}
