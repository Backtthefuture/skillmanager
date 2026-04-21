/**
 * Server-side security guards.
 *
 * Two threats this module defends against:
 *
 * 1. Drive-by CSRF — any webpage the user visits in the browser can issue
 *    `fetch('http://localhost:3456/api/skills/<id>', { method: 'DELETE', … })`
 *    and the server would happily execute it. We require either a
 *    `Sec-Fetch-Site: same-origin` header (sent by every modern browser for
 *    same-origin requests) or an `Origin` header that matches our own origin.
 *    Cross-origin requests from browsers will fail the check.
 *
 * 2. Arbitrary filesystem path injection — the mutating routes take paths
 *    (e.g. `body.path`) and pass them to `fs.rm` / `fs.writeFile` / rename.
 *    `confinePath()` resolves the candidate (following symlinks when they
 *    exist) and rejects anything that isn't under one of the directories the
 *    scanner legitimately covers (`~/.claude/…`, `~/.skill-hub/…`, discovered
 *    project roots, and `SKILL_HUB_EXTRA_PATHS`).
 */
import type { FastifyInstance } from 'fastify'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { getCachedResult } from './routes/skills.js'

const homedir = os.homedir()
const IS_WIN = process.platform === 'win32'

// ---------- Origin / CSRF guard ----------

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

export function registerOriginGuard(
  app: FastifyInstance,
  getAllowedOrigins: () => string[],
): void {
  app.addHook('onRequest', async (req, reply) => {
    const method = (req.method || '').toUpperCase()
    if (!MUTATING.has(method)) return
    if (req.url.startsWith('/ws')) return // websocket upgrade uses GET anyway

    const allowed = getAllowedOrigins().map((o) => o.toLowerCase())
    const origin = String(req.headers.origin || '').toLowerCase()
    const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase()
    const host = String(req.headers.host || '').toLowerCase()

    // Allow if browser reports same-origin.
    if (fetchSite === 'same-origin') return
    // Allow if Origin header matches one of our own origins exactly.
    if (origin && allowed.includes(origin)) return
    // Allow when there is NO origin header AND the Host header is loopback.
    // Browsers always send Origin on cross-origin mutations, so this case
    // only covers local tools (curl, tests) hitting loopback directly.
    if (!origin && (host.startsWith('127.0.0.1:') || host.startsWith('localhost:'))) return

    reply.status(403)
    return reply.send({
      ok: false,
      error: 'Forbidden: cross-origin mutation blocked',
    })
  })
}

// ---------- Path confinement ----------

function normalizeForCompare(p: string): string {
  const n = path.normalize(path.resolve(p))
  return IS_WIN ? n.toLowerCase() : n
}

function isUnderRoot(resolved: string, root: string): boolean {
  const r = normalizeForCompare(root)
  const c = normalizeForCompare(resolved)
  if (c === r) return true
  return c.startsWith(r + path.sep)
}

function staticSafeRoots(): string[] {
  return [
    path.resolve(homedir, '.claude'),
    path.resolve(homedir, '.skill-hub'),
  ]
}

function extraPathRoots(): string[] {
  const raw = process.env.SKILL_HUB_EXTRA_PATHS
  if (!raw) return []
  return raw
    .split(/[:,]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('~') ? path.join(homedir, p.slice(1)) : p))
    .map((p) => path.resolve(p))
}

/**
 * Roots we'll accept as write targets. Pulls from:
 *   - static Claude / Skill-Hub paths
 *   - project roots the most recent scan actually discovered
 *   - SKILL_HUB_EXTRA_PATHS
 *
 * Falls back to static roots alone when no scan has run yet.
 */
export function getSafeRoots(): string[] {
  const roots = new Set<string>()
  for (const r of staticSafeRoots()) roots.add(r)
  for (const r of extraPathRoots()) roots.add(r)
  const scan = getCachedResult()
  if (scan) {
    for (const proj of scan.projects) {
      roots.add(path.resolve(proj.path))
    }
  }
  return Array.from(roots)
}

/**
 * Resolve a user-supplied path, follow symlinks when possible, and require
 * the result to live inside one of the safe roots. Throws on any violation.
 *
 * Works for both existing paths (e.g. source of a copy/move, file to delete)
 * and not-yet-existing paths (e.g. copy/move target).
 */
export async function confinePath(
  input: unknown,
  roots: string[] = getSafeRoots(),
): Promise<string> {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('路径不能为空')
  }

  let resolved = path.resolve(input)

  // If the path exists, resolve symlinks so an attacker can't use a symlink
  // inside a safe root to reach somewhere that isn't.
  try {
    resolved = await fs.realpath(resolved)
  } catch {
    // Path doesn't exist yet — `path.resolve` alone is fine for write targets.
  }

  resolved = path.normalize(resolved)

  const fits = roots.some((r) => isUnderRoot(resolved, r))
  if (!fits) {
    throw new Error(`路径超出允许范围: ${input}`)
  }
  return resolved
}

/**
 * Same as `confinePath`, but also asserts that the path exists right now.
 * Use for sources of read/delete/move operations where a missing path is
 * itself a failure.
 */
export async function confineExistingPath(
  input: unknown,
  roots: string[] = getSafeRoots(),
): Promise<string> {
  const resolved = await confinePath(input, roots)
  try {
    await fs.access(resolved)
  } catch {
    throw new Error(`路径不存在: ${input}`)
  }
  return resolved
}
