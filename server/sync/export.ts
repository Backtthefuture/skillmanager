import fs from 'fs/promises'
import { spawn } from 'child_process'
import path from 'path'
import os from 'os'
import type { Skill } from '../types.js'
import { isSyncableSkill, materializeSkill, buildManifest, DEFAULT_GITIGNORE } from './layout.js'

/**
 * Escape hatch: package all syncable skills into a tarball. No GitHub required.
 *
 * Flow:
 *   1. Stage files into a temp dir under the same <agent>/<name>/ layout
 *      used by the GitHub vault, so a tarball can be symmetrically restored
 *      by extracting into a fresh vault.
 *   2. Add README.md + .skillhub/manifest.json + .gitignore.
 *   3. Shell out to `tar -czf` to create the archive.
 *   4. Read the archive into a Buffer for Fastify to send.
 *   5. Clean up staging.
 */

const README_CONTENT = `# Skill Hub Backup

This archive is an offline backup of your Claude / Codex / universal skills,
created by Skill Hub (https://github.com/Backtthefuture/huangshu).

Layout:
  <agent>/<skill-name>/SKILL.md
  <agent>/<skill-name>/... supporting files ...
  .skillhub/manifest.json   metadata about this archive

To restore manually: copy each <agent>/<skill> directory into the matching
agent skills directory on your machine:
  - claude-code → ~/.claude/skills/
  - codex       → ~/.codex/skills/
  - universal   → ~/.agents/skills/

Or: set up Skill Hub + connect a GitHub repo, push this content there, then
use the "从 GitHub 下载" feature on your new machine.
`

export interface ExportResult {
  ok: true
  buffer: Buffer
  filename: string
  skillCount: number
  fileCount: number
  excludedCount: number
}

export interface ExportError {
  ok: false
  error: string
}

export async function buildExportTarball(skills: Skill[]): Promise<ExportResult | ExportError> {
  const syncable = skills.filter(isSyncableSkill)
  const excluded = skills.length - syncable.length

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const rootName = `skill-hub-backup-${stamp}`
  const stagingBase = await fs.mkdtemp(path.join(os.tmpdir(), 'skillhub-export-'))
  const stagingRoot = path.join(stagingBase, rootName)
  await fs.mkdir(stagingRoot, { recursive: true })

  let fileCount = 0
  try {
    for (const skill of syncable) {
      const { files } = await materializeSkill(skill)
      for (const f of files) {
        const dest = path.join(stagingRoot, f.relPath)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        if (f.loaded && f.text != null) {
          await fs.writeFile(dest, f.text)
        } else {
          const buf = await fs.readFile(f.absSource)
          await fs.writeFile(dest, buf)
        }
        fileCount++
      }
    }

    // Metadata
    await fs.writeFile(path.join(stagingRoot, 'README.md'), README_CONTENT)
    await fs.mkdir(path.join(stagingRoot, '.skillhub'), { recursive: true })
    await fs.writeFile(
      path.join(stagingRoot, '.skillhub', 'manifest.json'),
      JSON.stringify({ ...buildManifest(os.hostname()), exportedBy: 'tar' }, null, 2) + '\n',
    )
    await fs.writeFile(path.join(stagingRoot, '.gitignore'), DEFAULT_GITIGNORE)

    // Build tarball
    const archivePath = path.join(stagingBase, `${rootName}.tar.gz`)
    const tarResult = await runTar(['-czf', archivePath, '-C', stagingBase, rootName])
    if (tarResult.code !== 0) {
      return { ok: false, error: `tar failed: ${tarResult.stderr}` }
    }

    const buffer = await fs.readFile(archivePath)
    return {
      ok: true,
      buffer,
      filename: `${rootName}.tar.gz`,
      skillCount: syncable.length,
      fileCount,
      excludedCount: excluded,
    }
  } finally {
    // Cleanup always runs
    try {
      await fs.rm(stagingBase, { recursive: true, force: true })
    } catch {}
  }
}

function runTar(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }))
  })
}
