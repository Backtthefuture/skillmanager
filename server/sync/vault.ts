import { spawn } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import type { SyncConfig } from './config.js'

/**
 * Git-backed vault. The vault is a plain clone of the user's GitHub repo at
 * ~/.local/share/skill-hub/vault/<owner>__<name>/. It's separate from the
 * live skills directories (`~/.claude/skills/`, etc.) so:
 *   - the file watcher doesn't see half-written merges
 *   - a failed push doesn't corrupt live skills
 *   - upload and download are two independent one-way flows, not in-place sync
 *
 * Auth: we never bake the PAT into the remote URL (that would leak it to
 * `git remote -v`). Instead we inject a one-shot inline credential.helper via
 * `git -c` every time we run a network op, reading the token from an env var
 * so it doesn't appear in process argv either.
 */

function vaultRoot(): string {
  // Read HOME lazily — tests may override process.env.HOME between calls.
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir()
  return path.join(home, '.local', 'share', 'skill-hub', 'vault')
}

export function vaultDirFor(config: Pick<SyncConfig, 'owner' | 'name'>): string {
  return path.join(vaultRoot(), `${config.owner}__${config.name}`)
}

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

interface RunOpts {
  cwd?: string
  token?: string
  timeoutMs?: number
  input?: string
}

export async function runGit(args: string[], opts: RunOpts = {}): Promise<GitResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    // Disable any local gitconfig hooks that might prompt
    GIT_ASKPASS: 'echo',
  }

  const finalArgs: string[] = []
  if (opts.token) {
    env.SKILLHUB_GIT_TOKEN = opts.token
    // Inline credential helper: reads username/password from env at invocation time.
    finalArgs.push(
      '-c',
      `credential.helper=!f() { echo username=x-access-token; echo password=$SKILLHUB_GIT_TOKEN; }; f`,
    )
  }
  finalArgs.push(...args)

  return new Promise((resolve) => {
    const child = spawn('git', finalArgs, {
      cwd: opts.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {}
    }, opts.timeoutMs ?? 60_000)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code: timedOut ? -1 : (code ?? -1),
        stdout,
        stderr: timedOut ? stderr + '\n[skill-hub] git command timed out' : stderr,
      })
    })

    if (opts.input) {
      child.stdin.write(opts.input)
    }
    child.stdin.end()
  })
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p)
    return s.isDirectory()
  } catch {
    return false
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export interface VaultStatus {
  vaultPath: string
  exists: boolean
  initialized: boolean    // git repo present
  remoteUrl: string | null
  currentBranch: string | null
  headSha: string | null
  isEmpty: boolean        // no commits yet
  fileCount: number
  lastFetchAt: string | null
}

const EMPTY_STATUS = (vaultPath: string): VaultStatus => ({
  vaultPath,
  exists: false,
  initialized: false,
  remoteUrl: null,
  currentBranch: null,
  headSha: null,
  isEmpty: true,
  fileCount: 0,
  lastFetchAt: null,
})

export async function getVaultStatus(config: SyncConfig): Promise<VaultStatus> {
  const vaultPath = vaultDirFor(config)
  if (!(await dirExists(vaultPath))) {
    return EMPTY_STATUS(vaultPath)
  }
  const gitDir = path.join(vaultPath, '.git')
  if (!(await dirExists(gitDir))) {
    return { ...EMPTY_STATUS(vaultPath), exists: true }
  }

  const [remoteRes, branchRes, headRes] = await Promise.all([
    runGit(['config', '--get', 'remote.origin.url'], { cwd: vaultPath }),
    runGit(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: vaultPath }),
    runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: vaultPath }),
  ])

  const fileCount = await countTrackedFiles(vaultPath)
  let lastFetchAt: string | null = null
  try {
    const fetchHead = path.join(vaultPath, '.git', 'FETCH_HEAD')
    const st = await fs.stat(fetchHead)
    lastFetchAt = st.mtime.toISOString()
  } catch {}

  return {
    vaultPath,
    exists: true,
    initialized: true,
    remoteUrl: remoteRes.stdout.trim() || null,
    currentBranch: branchRes.stdout.trim() || null,
    headSha: headRes.code === 0 ? headRes.stdout.trim() || null : null,
    isEmpty: headRes.code !== 0,
    fileCount,
    lastFetchAt,
  }
}

async function countTrackedFiles(vaultPath: string): Promise<number> {
  const res = await runGit(['ls-files'], { cwd: vaultPath })
  if (res.code !== 0) return 0
  return res.stdout.split('\n').filter(Boolean).length
}

/**
 * Ensure the vault is cloned and up to date. Idempotent:
 * - doesn't exist → clone
 * - exists + same remote → fetch
 * - exists + different remote → error (user must disconnect old repo first)
 *
 * Handles the "brand new empty GitHub repo" case by falling back to
 * `git init` + setting the remote manually.
 */
export async function ensureVault(config: SyncConfig): Promise<{ ok: true; status: VaultStatus } | { ok: false; error: string }> {
  const vaultPath = vaultDirFor(config)
  await fs.mkdir(path.dirname(vaultPath), { recursive: true, mode: 0o700 })

  const expectedRemote = `https://github.com/${config.owner}/${config.name}.git`

  const existing = await dirExists(vaultPath)
  if (existing) {
    const gitDir = path.join(vaultPath, '.git')
    if (await dirExists(gitDir)) {
      // Check remote matches
      const remote = await runGit(['config', '--get', 'remote.origin.url'], { cwd: vaultPath })
      const actualRemote = remote.stdout.trim().replace(/\.git$/, '')
      const expectedNoSuffix = expectedRemote.replace(/\.git$/, '')
      if (actualRemote && actualRemote !== expectedNoSuffix) {
        return {
          ok: false,
          error: `Vault 目录已存在但指向不同的仓库 (${actualRemote})。请手动删除 ${vaultPath} 后重试。`,
        }
      }
      // Fetch latest
      const fetch = await runGit(['fetch', 'origin', '--prune'], {
        cwd: vaultPath,
        token: config.token,
        timeoutMs: 120_000,
      })
      if (fetch.code !== 0) {
        return { ok: false, error: `git fetch 失败: ${fetch.stderr || fetch.stdout}` }
      }
      // Fast-forward local default branch to origin if possible
      await runGit(['reset', '--hard', `origin/${config.defaultBranch}`], {
        cwd: vaultPath,
      })
      return { ok: true, status: await getVaultStatus(config) }
    }
    // Exists but not a git repo — bail out
    return {
      ok: false,
      error: `Vault 目录已存在但不是一个 git 仓库: ${vaultPath}`,
    }
  }

  // Clone
  const clone = await runGit(
    ['clone', '--quiet', expectedRemote, vaultPath],
    { token: config.token, timeoutMs: 180_000 },
  )

  if (clone.code === 0) {
    // Successful clone. If the repo is empty, HEAD will not exist yet — still OK.
    return { ok: true, status: await getVaultStatus(config) }
  }

  // Clone failed. Common cause: brand-new empty repo. Fall back to init + add remote.
  const emptyRepoHint = /remote HEAD refers to nonexistent ref|empty repository/i.test(
    clone.stderr + clone.stdout,
  )
  if (emptyRepoHint || clone.code !== 0) {
    // Try the manual init path. First, clean up any partial clone.
    try {
      await fs.rm(vaultPath, { recursive: true, force: true })
    } catch {}
    await fs.mkdir(vaultPath, { recursive: true, mode: 0o700 })

    const init = await runGit(['init', '-b', config.defaultBranch || 'main'], { cwd: vaultPath })
    if (init.code !== 0) {
      return { ok: false, error: `git init 失败: ${init.stderr}` }
    }
    const addRemote = await runGit(['remote', 'add', 'origin', expectedRemote], { cwd: vaultPath })
    if (addRemote.code !== 0) {
      return { ok: false, error: `git remote add 失败: ${addRemote.stderr}` }
    }
    // Configure local committer identity so commits don't need global git config
    await runGit(['config', 'user.name', 'Skill Hub'], { cwd: vaultPath })
    await runGit(['config', 'user.email', 'skill-hub@localhost'], { cwd: vaultPath })

    // If the remote actually had commits we would have cloned successfully, so
    // we don't try to pull here. An init'd empty vault is the correct state.
    return { ok: true, status: await getVaultStatus(config) }
  }

  return { ok: false, error: `git clone 失败: ${clone.stderr || clone.stdout}` }
}

/**
 * Stage everything, commit, push. Used by the upload flow.
 * Returns `{ noop: true }` if the working tree was clean (nothing to commit).
 */
export async function commitAndPush(
  config: SyncConfig,
  message: string,
): Promise<
  | { ok: true; noop: true }
  | { ok: true; noop: false; sha: string }
  | { ok: false; error: string }
> {
  const vaultPath = vaultDirFor(config)

  // Make sure committer identity exists even for a pre-existing clone
  await runGit(['config', 'user.name', 'Skill Hub'], { cwd: vaultPath })
  await runGit(['config', 'user.email', 'skill-hub@localhost'], { cwd: vaultPath })

  const add = await runGit(['add', '-A'], { cwd: vaultPath })
  if (add.code !== 0) {
    return { ok: false, error: `git add 失败: ${add.stderr}` }
  }

  const status = await runGit(['status', '--porcelain'], { cwd: vaultPath })
  if (!status.stdout.trim()) {
    return { ok: true, noop: true }
  }

  const commit = await runGit(['commit', '-m', message], { cwd: vaultPath })
  if (commit.code !== 0) {
    return { ok: false, error: `git commit 失败: ${commit.stderr}` }
  }

  const push = await runGit(
    ['push', 'origin', `HEAD:${config.defaultBranch}`],
    { cwd: vaultPath, token: config.token, timeoutMs: 180_000 },
  )
  if (push.code !== 0) {
    return { ok: false, error: `git push 失败: ${push.stderr}` }
  }

  const head = await runGit(['rev-parse', 'HEAD'], { cwd: vaultPath })
  return { ok: true, noop: false, sha: head.stdout.trim() }
}

/**
 * Recursively list all files under vaultPath, excluding .git/. Paths are
 * relative to vaultPath, using forward slashes.
 */
export async function listVaultFiles(vaultPath: string): Promise<string[]> {
  if (!(await dirExists(vaultPath))) return []
  const out: string[] = []
  async function walk(dir: string, rel: string) {
    let entries: any[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue
      const abs = path.join(dir, entry.name)
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(abs, relPath)
      } else if (entry.isFile()) {
        out.push(relPath)
      }
    }
  }
  await walk(vaultPath, '')
  return out.sort()
}

export async function readVaultFile(vaultPath: string, relPath: string): Promise<string | null> {
  const abs = path.join(vaultPath, relPath)
  // Defense-in-depth: reject anything that escapes the vault
  const normalized = path.normalize(abs)
  if (!normalized.startsWith(path.normalize(vaultPath) + path.sep)) return null
  try {
    return await fs.readFile(abs, 'utf-8')
  } catch {
    return null
  }
}

export async function writeVaultFile(vaultPath: string, relPath: string, content: string | Buffer): Promise<void> {
  const abs = path.join(vaultPath, relPath)
  const normalized = path.normalize(abs)
  if (!normalized.startsWith(path.normalize(vaultPath) + path.sep)) {
    throw new Error(`Refusing to write outside vault: ${relPath}`)
  }
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content)
}

export async function removeVaultFile(vaultPath: string, relPath: string): Promise<void> {
  const abs = path.join(vaultPath, relPath)
  const normalized = path.normalize(abs)
  if (!normalized.startsWith(path.normalize(vaultPath) + path.sep)) return
  try {
    await fs.rm(abs, { force: true })
  } catch {}
}

/** Remove everything under vaultPath except .git. Used before a full re-materialization. */
export async function clearVaultTree(vaultPath: string): Promise<void> {
  if (!(await dirExists(vaultPath))) return
  const entries = await fs.readdir(vaultPath, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git') continue
    await fs.rm(path.join(vaultPath, entry.name), { recursive: true, force: true })
  }
}

/** Expose the helpers for tests / diagnostics */
export async function vaultFileExists(vaultPath: string, relPath: string): Promise<boolean> {
  return fileExists(path.join(vaultPath, relPath))
}
