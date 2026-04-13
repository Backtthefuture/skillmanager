import type { FastifyInstance } from 'fastify'
import {
  listTrash,
  restoreFromTrash,
  purgeOne,
  purgeExpired,
  TrashConflictError,
  TrashNotFoundError,
} from '../trash/store.js'
import { invalidateCache } from './skills.js'

// newId() from ../trash/store.ts always matches `<base36>-<hex>`. Reject
// anything else so an attacker can't smuggle path traversal into fs.rm.
const TRASH_ID_RE = /^[a-z0-9]{1,20}-[a-f0-9]{4,32}$/

function assertSafeTrashId(id: unknown): string {
  if (typeof id !== 'string' || !TRASH_ID_RE.test(id)) {
    throw new Error(`非法 trash id: ${String(id)}`)
  }
  return id
}

export async function trashRoutes(app: FastifyInstance) {
  // List trash entries (also purges expired as a side effect)
  app.get('/api/trash', async () => {
    const items = await listTrash()
    return { ok: true, items }
  })

  // Restore a trash entry back to its original location
  app.post<{
    Params: { id: string }
    Querystring: { force?: string }
  }>('/api/trash/:id/restore', async (req, reply) => {
    let id: string
    try {
      id = assertSafeTrashId(req.params.id)
    } catch (err: any) {
      reply.status(400)
      return { ok: false, error: err.message }
    }
    const force = req.query.force === 'true' || req.query.force === '1'
    try {
      const meta = await restoreFromTrash(id, force)
      invalidateCache()
      return { ok: true, meta }
    } catch (err: any) {
      if (err instanceof TrashConflictError) {
        reply.status(409)
        return { ok: false, error: err.message, code: 'CONFLICT', targetPath: err.targetPath }
      }
      if (err instanceof TrashNotFoundError) {
        reply.status(404)
        return { ok: false, error: err.message, code: 'NOT_FOUND' }
      }
      reply.status(500)
      return { ok: false, error: err?.message || '还原失败' }
    }
  })

  // Permanently delete a single trash entry
  app.delete<{ Params: { id: string } }>('/api/trash/:id', async (req, reply) => {
    let id: string
    try {
      id = assertSafeTrashId(req.params.id)
    } catch (err: any) {
      reply.status(400)
      return { ok: false, error: err.message }
    }
    const ok = await purgeOne(id)
    return { ok }
  })

  // Manual purge of expired entries
  app.post('/api/trash/purge-expired', async () => {
    const removed = await purgeExpired()
    return { ok: true, removed }
  })
}
