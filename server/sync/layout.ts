import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import type { Skill } from '../types.js'

/**
 * Maps between local skills and vault-relative paths.
 *
 *   vault/<agent>/<skill-name>/SKILL.md
 *   vault/<agent>/<skill-name>/...sibling files...
 *
 * Universal skills (from shared .agents/skills/ paths) go under `universal/`.
 * Unknown-agent skills are skipped (the user should label them first).
 */

const MAX_FILE_BYTES = 1_000_000 // 1 MB — hard cap to prevent blob bloat

// Patterns to ignore when copying skill files into the vault. Same spirit as
// the default .gitignore we write on first upload.
const IGNORED_DIRS = new Set([
  'node_modules', '__pycache__', '.venv', 'venv', '.DS_Store',
  '.git', '.svn', '.hg', '.idea', '.vscode',
])

const IGNORED_EXTS = new Set([
  '.db', '.sqlite', '.sqlite3',
  '.pyc', '.pyo',
])

export function isSyncableSkill(skill: Skill): boolean {
  // Marketplace / plugin skills aren't "mine"
  if (skill.scope === 'plugin') return false
  // Framework-installed skills belong to the framework, not the user
  if (skill.source === 'newmax') return false
  if (skill.source === 'agents') return false
  // Don't sync skills we can't attribute to an agent
  if (skill.agent === 'unknown') return false
  return true
}

/** vault-relative root dir for a given skill. */
export function vaultDirForSkill(skill: Skill): string {
  const safeName = sanitizeSegment(skill.name || path.basename(skill.realPath))
  return `${skill.agent}/${safeName}`
}

function sanitizeSegment(s: string): string {
  // Replace path separators, control chars, and traversal sequences
  let cleaned = s.replace(/[\\/\x00-\x1f]/g, '_').trim()
  cleaned = cleaned.replace(/\.\.+/g, '_') // collapse any `..` or longer runs
  if (cleaned.startsWith('.')) cleaned = '_' + cleaned.slice(1)
  return cleaned || 'unnamed'
}

export interface MaterializedFile {
  /** vault-relative path, e.g. "claude-code/foo/SKILL.md" */
  relPath: string
  /** absolute source path on disk */
  absSource: string
  /** sha1 hex of content */
  sha: string
  /** file size in bytes */
  size: number
  /** whether we loaded the content into memory (false if binary/too-large — still uploaded as a copy) */
  loaded: boolean
  /** cached text content (only set for scannable text files) */
  text?: string
}

export interface MaterializeResult {
  files: MaterializedFile[]
  skipped: { relPath: string; reason: string }[]
}

/**
 * Walk a skill's directory and produce the list of files that should appear in
 * the vault. Respects ignore patterns and the per-file size cap.
 */
export async function materializeSkill(skill: Skill): Promise<MaterializeResult> {
  const vaultDir = vaultDirForSkill(skill)
  const files: MaterializedFile[] = []
  const skipped: { relPath: string; reason: string }[] = []

  async function walk(abs: string, relInsideSkill: string) {
    let entries: any[]
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const entryAbs = path.join(abs, entry.name)
      const entryRel = relInsideSkill ? `${relInsideSkill}/${entry.name}` : entry.name
      const vaultRel = `${vaultDir}/${entryRel}`

      if (entry.isDirectory()) {
        await walk(entryAbs, entryRel)
        continue
      }
      if (!entry.isFile()) continue

      const ext = path.extname(entry.name).toLowerCase()
      if (IGNORED_EXTS.has(ext)) {
        skipped.push({ relPath: vaultRel, reason: `忽略扩展名 ${ext}` })
        continue
      }

      let stat
      try {
        stat = await fs.stat(entryAbs)
      } catch {
        continue
      }

      if (stat.size > MAX_FILE_BYTES) {
        skipped.push({
          relPath: vaultRel,
          reason: `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)} MB > 1 MB)`,
        })
        continue
      }

      const buf = await fs.readFile(entryAbs)
      const sha = crypto.createHash('sha1').update(buf).digest('hex')
      const isText = looksLikeText(buf)
      files.push({
        relPath: vaultRel,
        absSource: entryAbs,
        sha,
        size: stat.size,
        loaded: isText,
        text: isText ? buf.toString('utf-8') : undefined,
      })
    }
  }

  await walk(skill.realPath, '')
  return { files, skipped }
}

/**
 * Heuristic: does this buffer look like UTF-8 text? We only scan text files
 * for secrets, and we only diff text files by content hash (binaries diff by
 * hash of raw bytes, which is fine).
 */
function looksLikeText(buf: Buffer): boolean {
  if (buf.length === 0) return true
  const sampleSize = Math.min(buf.length, 8192)
  let nonPrintable = 0
  for (let i = 0; i < sampleSize; i++) {
    const b = buf[i]
    if (b === 0) return false
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) nonPrintable++
  }
  return nonPrintable / sampleSize < 0.02
}

/**
 * Default .gitignore content for a fresh vault. Kept conservative: excludes
 * things that are almost never intentionally checked in, but keeps images and
 * docs since many skills have templates with them.
 */
export const DEFAULT_GITIGNORE = `# Skill Hub — default ignore patterns
# Local caches
node_modules/
__pycache__/
*.pyc
*.pyo
.venv/
venv/
.DS_Store

# Local DBs
*.db
*.sqlite
*.sqlite3

# OS / editor clutter
Thumbs.db
.idea/
.vscode/
`

/**
 * Vault layout metadata. Written as .skillhub/manifest.json on first upload.
 * Lets future versions introspect the schema.
 */
export interface VaultManifest {
  schemaVersion: 1
  generator: 'skill-hub'
  lastUploadAt: string
  lastUploadHostname: string
}

export function buildManifest(hostname: string): VaultManifest {
  return {
    schemaVersion: 1,
    generator: 'skill-hub',
    lastUploadAt: new Date().toISOString(),
    lastUploadHostname: hostname,
  }
}
