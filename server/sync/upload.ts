import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import os from 'os'
import type { Skill } from '../types.js'
import type { SyncConfig } from './config.js'
import {
  ensureVault,
  vaultDirFor,
  listVaultFiles,
  readVaultFile,
  writeVaultFile,
  removeVaultFile,
  commitAndPush,
} from './vault.js'
import {
  isSyncableSkill,
  materializeSkill,
  vaultDirForSkill,
  DEFAULT_GITIGNORE,
  buildManifest,
  type MaterializedFile,
} from './layout.js'
import { scanContent, summarize, type Finding, type ScanSummary } from './secrets.js'

/**
 * The upload pipeline:
 *   1. ensure vault is cloned + fetched
 *   2. materialize every syncable local skill → in-memory MaterializedFile[]
 *   3. diff against the current vault working tree
 *   4. scan text contents for secrets / abs paths
 *   5. preview: return summary
 *   6. confirm: actually write the files, commit, push
 *
 * Preview and confirm are separate HTTP calls. Confirm re-runs materialize +
 * diff from scratch so the preview can't be tampered with client-side.
 */

export interface SkillChangeSummary {
  agent: string
  name: string
  vaultDir: string              // e.g. "claude-code/foo"
  status: 'add' | 'update' | 'delete' | 'unchanged'
  filesAdded: number
  filesUpdated: number
  filesDeleted: number
  filesUnchanged: number
}

export interface UploadPreview {
  localSkillCount: number
  syncableSkillCount: number
  excludedSkillCount: number
  skillChanges: SkillChangeSummary[]
  totals: {
    skillsAdded: number
    skillsUpdated: number
    skillsDeleted: number
    skillsUnchanged: number
    filesAdded: number
    filesUpdated: number
    filesDeleted: number
  }
  scan: ScanSummary
  skippedFiles: { relPath: string; reason: string }[]
}

function sha1(content: string | Buffer): string {
  return crypto.createHash('sha1').update(content).digest('hex')
}

interface PlannedFile {
  relPath: string
  sha: string
  source: MaterializedFile
}

interface PlanResult {
  vaultPath: string
  planned: Map<string, PlannedFile>           // vault-relative → planned file
  toDelete: string[]                          // vault-relative files that should be removed
  skillChanges: SkillChangeSummary[]
  skippedFiles: { relPath: string; reason: string }[]
  excludedSkillCount: number
  syncableSkillCount: number
}

async function planUpload(
  config: SyncConfig,
  skills: Skill[],
): Promise<{ ok: true; plan: PlanResult } | { ok: false; error: string }> {
  const ensured = await ensureVault(config)
  if (!ensured.ok) return { ok: false, error: ensured.error }

  const vaultPath = vaultDirFor(config)

  // Walk the vault as it currently is, hash each file. Skip .skillhub and
  // .gitignore — we manage those separately and don't want to accidentally
  // delete them if the user has an empty skill set.
  const existingFiles = await listVaultFiles(vaultPath)
  const existingHashes = new Map<string, string>()
  for (const rel of existingFiles) {
    if (rel === '.gitignore') continue
    if (rel.startsWith('.skillhub/')) continue
    const content = await readVaultFile(vaultPath, rel)
    if (content == null) continue
    existingHashes.set(rel, sha1(content))
  }

  // Materialize every syncable skill
  const syncable = skills.filter(isSyncableSkill)
  const excluded = skills.length - syncable.length

  const planned = new Map<string, PlannedFile>()
  const skippedFiles: { relPath: string; reason: string }[] = []
  const skillChanges: SkillChangeSummary[] = []

  for (const skill of syncable) {
    const vaultDir = vaultDirForSkill(skill)
    const { files, skipped } = await materializeSkill(skill)
    skippedFiles.push(...skipped)

    // Per-skill diff: for every file in this skill, compare hash to existing vault
    let filesAdded = 0
    let filesUpdated = 0
    let filesUnchanged = 0

    for (const f of files) {
      const existing = existingHashes.get(f.relPath)
      if (existing == null) filesAdded++
      else if (existing !== f.sha) filesUpdated++
      else filesUnchanged++

      planned.set(f.relPath, { relPath: f.relPath, sha: f.sha, source: f })
    }

    // Files that used to exist under this skill's vault dir but no longer
    // appear locally count as deletes within this skill.
    const skillPrefix = `${vaultDir}/`
    let filesDeleted = 0
    for (const existingRel of existingHashes.keys()) {
      if (existingRel.startsWith(skillPrefix) && !planned.has(existingRel)) {
        filesDeleted++
      }
    }

    let status: SkillChangeSummary['status'] = 'unchanged'
    if (filesUnchanged > 0 && filesAdded === 0 && filesUpdated === 0 && filesDeleted === 0) {
      status = 'unchanged'
    } else if (!existingHashes.has(`${vaultDir}/SKILL.md`) && filesAdded > 0) {
      // New skill (SKILL.md didn't exist in vault before)
      status = 'add'
    } else {
      status = 'update'
    }

    skillChanges.push({
      agent: skill.agent,
      name: skill.name,
      vaultDir,
      status,
      filesAdded,
      filesUpdated,
      filesDeleted,
      filesUnchanged,
    })
  }

  // Anything in the vault that wasn't planned (and isn't under a skill we kept)
  // is a deletion candidate. Group by `<agent>/<name>/` to report as skill-level
  // deletes.
  const plannedSkillDirs = new Set(skillChanges.map((c) => c.vaultDir))
  const deletedSkillDirs = new Set<string>()
  const toDelete: string[] = []

  for (const rel of existingHashes.keys()) {
    if (planned.has(rel)) continue
    const firstTwo = rel.split('/').slice(0, 2).join('/')
    if (plannedSkillDirs.has(firstTwo)) {
      // Within a kept skill but not planned → file-level delete (already counted)
      toDelete.push(rel)
      continue
    }
    // Outside any kept skill → whole-skill delete
    deletedSkillDirs.add(firstTwo)
    toDelete.push(rel)
  }

  for (const dir of deletedSkillDirs) {
    const [agent, ...nameParts] = dir.split('/')
    const name = nameParts.join('/')
    let filesDeleted = 0
    for (const rel of existingHashes.keys()) {
      if (rel.startsWith(`${dir}/`)) filesDeleted++
    }
    skillChanges.push({
      agent: agent || 'unknown',
      name: name || '(unnamed)',
      vaultDir: dir,
      status: 'delete',
      filesAdded: 0,
      filesUpdated: 0,
      filesDeleted,
      filesUnchanged: 0,
    })
  }

  return {
    ok: true,
    plan: {
      vaultPath,
      planned,
      toDelete,
      skillChanges,
      skippedFiles,
      excludedSkillCount: excluded,
      syncableSkillCount: syncable.length,
    },
  }
}

export async function previewUpload(
  config: SyncConfig,
  skills: Skill[],
): Promise<{ ok: true; preview: UploadPreview } | { ok: false; error: string }> {
  const planned = await planUpload(config, skills)
  if (!planned.ok) return planned
  const plan = planned.plan

  // Run secret scan over planned text files
  const findings: Finding[] = []
  for (const [, f] of plan.planned) {
    if (f.source.loaded && f.source.text != null) {
      findings.push(...scanContent(f.relPath, f.source.text))
    }
  }

  const totals = {
    skillsAdded: plan.skillChanges.filter((c) => c.status === 'add').length,
    skillsUpdated: plan.skillChanges.filter((c) => c.status === 'update').length,
    skillsDeleted: plan.skillChanges.filter((c) => c.status === 'delete').length,
    skillsUnchanged: plan.skillChanges.filter((c) => c.status === 'unchanged').length,
    filesAdded: plan.skillChanges.reduce((n, c) => n + c.filesAdded, 0),
    filesUpdated: plan.skillChanges.reduce((n, c) => n + c.filesUpdated, 0),
    filesDeleted: plan.skillChanges.reduce((n, c) => n + c.filesDeleted, 0),
  }

  return {
    ok: true,
    preview: {
      localSkillCount: skills.length,
      syncableSkillCount: plan.syncableSkillCount,
      excludedSkillCount: plan.excludedSkillCount,
      skillChanges: plan.skillChanges,
      totals,
      scan: summarize(findings),
      skippedFiles: plan.skippedFiles,
    },
  }
}

export async function executeUpload(
  config: SyncConfig,
  skills: Skill[],
  opts: { allowSecrets: boolean },
): Promise<
  | { ok: true; preview: UploadPreview; sha: string; noop: boolean }
  | { ok: false; error: string; preview?: UploadPreview }
> {
  const planned = await planUpload(config, skills)
  if (!planned.ok) return { ok: false, error: planned.error }
  const plan = planned.plan

  // Secret re-scan — we don't trust a client confirmation without re-checking
  const findings: Finding[] = []
  for (const [, f] of plan.planned) {
    if (f.source.loaded && f.source.text != null) {
      findings.push(...scanContent(f.relPath, f.source.text))
    }
  }

  const scanSummary = summarize(findings)
  if (scanSummary.danger > 0 && !opts.allowSecrets) {
    // Construct a partial preview so the UI can show what we found
    const totals = {
      skillsAdded: plan.skillChanges.filter((c) => c.status === 'add').length,
      skillsUpdated: plan.skillChanges.filter((c) => c.status === 'update').length,
      skillsDeleted: plan.skillChanges.filter((c) => c.status === 'delete').length,
      skillsUnchanged: plan.skillChanges.filter((c) => c.status === 'unchanged').length,
      filesAdded: plan.skillChanges.reduce((n, c) => n + c.filesAdded, 0),
      filesUpdated: plan.skillChanges.reduce((n, c) => n + c.filesUpdated, 0),
      filesDeleted: plan.skillChanges.reduce((n, c) => n + c.filesDeleted, 0),
    }
    return {
      ok: false,
      error: `检测到 ${scanSummary.danger} 个疑似密钥,出于安全考虑已阻止上传。如果是误报,请在前端勾选"我已确认,继续上传"后重试。`,
      preview: {
        localSkillCount: skills.length,
        syncableSkillCount: plan.syncableSkillCount,
        excludedSkillCount: plan.excludedSkillCount,
        skillChanges: plan.skillChanges,
        totals,
        scan: scanSummary,
        skippedFiles: plan.skippedFiles,
      },
    }
  }

  // Materialize into the vault working tree
  //  1. write / update every planned file
  //  2. delete files listed in toDelete
  //  3. write default .gitignore if missing
  //  4. update .skillhub/manifest.json

  for (const [, f] of plan.planned) {
    if (f.source.loaded && f.source.text != null) {
      await writeVaultFile(plan.vaultPath, f.relPath, f.source.text)
    } else {
      // Binary: copy bytes directly
      const buf = await fs.readFile(f.source.absSource)
      await writeVaultFile(plan.vaultPath, f.relPath, buf)
    }
  }
  for (const rel of plan.toDelete) {
    await removeVaultFile(plan.vaultPath, rel)
  }

  // Also garbage-collect empty dirs under the vault (don't recurse into .git)
  await removeEmptyDirs(plan.vaultPath)

  // Ensure .gitignore exists
  try {
    await fs.access(path.join(plan.vaultPath, '.gitignore'))
  } catch {
    await writeVaultFile(plan.vaultPath, '.gitignore', DEFAULT_GITIGNORE)
  }

  // Write manifest
  const manifest = buildManifest(os.hostname())
  await writeVaultFile(plan.vaultPath, '.skillhub/manifest.json', JSON.stringify(manifest, null, 2) + '\n')

  // Commit + push
  const message = composeCommitMessage(plan.skillChanges, os.hostname())
  const pushed = await commitAndPush(config, message)
  if (!pushed.ok) return { ok: false, error: pushed.error }

  const totals = {
    skillsAdded: plan.skillChanges.filter((c) => c.status === 'add').length,
    skillsUpdated: plan.skillChanges.filter((c) => c.status === 'update').length,
    skillsDeleted: plan.skillChanges.filter((c) => c.status === 'delete').length,
    skillsUnchanged: plan.skillChanges.filter((c) => c.status === 'unchanged').length,
    filesAdded: plan.skillChanges.reduce((n, c) => n + c.filesAdded, 0),
    filesUpdated: plan.skillChanges.reduce((n, c) => n + c.filesUpdated, 0),
    filesDeleted: plan.skillChanges.reduce((n, c) => n + c.filesDeleted, 0),
  }

  return {
    ok: true,
    sha: 'sha' in pushed ? pushed.sha : '',
    noop: pushed.noop,
    preview: {
      localSkillCount: skills.length,
      syncableSkillCount: plan.syncableSkillCount,
      excludedSkillCount: plan.excludedSkillCount,
      skillChanges: plan.skillChanges,
      totals,
      scan: scanSummary,
      skippedFiles: plan.skippedFiles,
    },
  }
}

function composeCommitMessage(changes: SkillChangeSummary[], hostname: string): string {
  const added = changes.filter((c) => c.status === 'add').length
  const updated = changes.filter((c) => c.status === 'update').length
  const deleted = changes.filter((c) => c.status === 'delete').length
  const parts: string[] = []
  if (added) parts.push(`+${added}`)
  if (updated) parts.push(`~${updated}`)
  if (deleted) parts.push(`-${deleted}`)
  const summary = parts.length ? parts.join(' ') : 'no-op'
  return `skill-hub upload: ${summary} (from ${hostname})`
}

async function removeEmptyDirs(root: string): Promise<void> {
  async function walk(dir: string): Promise<boolean> {
    let entries: any[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return false
    }
    let remaining = 0
    for (const entry of entries) {
      if (entry.name === '.git') {
        remaining++
        continue
      }
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const isEmpty = await walk(full)
        if (isEmpty && dir !== root) {
          try {
            await fs.rmdir(full)
          } catch {
            remaining++
          }
        } else {
          remaining++
        }
      } else {
        remaining++
      }
    }
    return remaining === 0
  }
  await walk(root)
}
