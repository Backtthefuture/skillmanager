import { listTrash, restoreFromTrash, purgeOne, purgeExpired, TrashConflictError, TrashNotFoundError, } from '../trash/store.js';
import { invalidateCache } from './skills.js';
export async function trashRoutes(app) {
    // List trash entries (also purges expired as a side effect)
    app.get('/api/trash', async () => {
        const items = await listTrash();
        return { ok: true, items };
    });
    // Restore a trash entry back to its original location
    app.post('/api/trash/:id/restore', async (req, reply) => {
        const { id } = req.params;
        const force = req.query.force === 'true' || req.query.force === '1';
        try {
            const meta = await restoreFromTrash(id, force);
            invalidateCache();
            return { ok: true, meta };
        }
        catch (err) {
            if (err instanceof TrashConflictError) {
                reply.status(409);
                return { ok: false, error: err.message, code: 'CONFLICT', targetPath: err.targetPath };
            }
            if (err instanceof TrashNotFoundError) {
                reply.status(404);
                return { ok: false, error: err.message, code: 'NOT_FOUND' };
            }
            reply.status(500);
            return { ok: false, error: err?.message || '还原失败' };
        }
    });
    // Permanently delete a single trash entry
    app.delete('/api/trash/:id', async (req) => {
        const ok = await purgeOne(req.params.id);
        return { ok };
    });
    // Manual purge of expired entries
    app.post('/api/trash/purge-expired', async () => {
        const removed = await purgeExpired();
        return { ok: true, removed };
    });
}
