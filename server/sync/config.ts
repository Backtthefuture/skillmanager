import fs from 'fs/promises'
import path from 'path'
import os from 'os'

/**
 * Sync config (GitHub repo URL + PAT).
 *
 * Stored at ~/.config/skill-hub/credentials.json with mode 0600. Same security
 * model as ~/.netrc or ~/.config/gh/hosts.yml — readable only by the current
 * user. v2 can upgrade to the OS keychain if users ask.
 */

export interface SyncConfig {
  repoUrl: string
  owner: string
  name: string
  defaultBranch: string
  token: string
  lastValidatedAt: string | null
}

export interface PublicSyncConfig {
  connected: boolean
  repoUrl: string | null
  owner: string | null
  name: string | null
  defaultBranch: string | null
  hasToken: boolean
  lastValidatedAt: string | null
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'skill-hub')
const CONFIG_PATH = path.join(CONFIG_DIR, 'credentials.json')

export async function readConfig(): Promise<SyncConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as SyncConfig
    if (!parsed.repoUrl || !parsed.token) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeConfig(config: SyncConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  // Write with restrictive mode. On Linux/macOS the mode sticks on create; we
  // also chmod after to handle the case where the file already existed.
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
  try {
    await fs.chmod(CONFIG_PATH, 0o600)
  } catch {}
}

export async function deleteConfig(): Promise<void> {
  try {
    await fs.unlink(CONFIG_PATH)
  } catch {}
}

/** Redacted view, safe to return from API. */
export function toPublic(config: SyncConfig | null): PublicSyncConfig {
  if (!config) {
    return {
      connected: false,
      repoUrl: null,
      owner: null,
      name: null,
      defaultBranch: null,
      hasToken: false,
      lastValidatedAt: null,
    }
  }
  return {
    connected: true,
    repoUrl: config.repoUrl,
    owner: config.owner,
    name: config.name,
    defaultBranch: config.defaultBranch,
    hasToken: Boolean(config.token),
    lastValidatedAt: config.lastValidatedAt,
  }
}

/**
 * Parse a GitHub repo URL into `{owner, name}`. Accepts:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 * - owner/repo
 */
export function parseRepoUrl(input: string): { owner: string; name: string } | null {
  const s = input.trim()
  if (!s) return null

  // git@github.com:owner/repo(.git)?
  const sshMatch = s.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (sshMatch) return { owner: sshMatch[1], name: sshMatch[2] }

  // https://github.com/owner/repo(.git)?
  const httpsMatch = s.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  if (httpsMatch) return { owner: httpsMatch[1], name: httpsMatch[2] }

  // bare owner/repo
  const bareMatch = s.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/)
  if (bareMatch) return { owner: bareMatch[1], name: bareMatch[2] }

  return null
}
