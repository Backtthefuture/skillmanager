import { createSnapshot, getHistory, getVersion, diffVersions, diffWithCurrent, rollback, deleteVersion, } from '../versioning/store.js';
import { invalidateCache } from './skills.js';
import { confinePath, confineExistingPath } from '../security.js';
export async function versionRoutes(app) {
    // 创建快照
    app.post('/api/versions/snapshot', async (req, reply) => {
        const { skillPath, skillName, message } = req.body;
        let safePath;
        try {
            safePath = await confineExistingPath(skillPath);
        }
        catch (err) {
            reply.status(403);
            return { ok: false, error: err?.message || '路径不合法' };
        }
        try {
            const meta = await createSnapshot(safePath, skillName, message, 'manual');
            return { ok: true, version: meta };
        }
        catch (e) {
            return { ok: false, error: e.message };
        }
    });
    // 获取版本历史
    app.get('/api/versions/history', async (req) => {
        const { skillPath } = req.query;
        const history = await getHistory(skillPath);
        return { history };
    });
    // 获取某个版本的完整内容
    app.get('/api/versions/detail', async (req) => {
        const { skillPath, versionId } = req.query;
        const version = await getVersion(skillPath, versionId);
        if (!version)
            return { ok: false, error: 'Version not found' };
        return { ok: true, version };
    });
    // 对比两个版本
    app.get('/api/versions/diff', async (req) => {
        const { skillPath, oldId, newId } = req.query;
        const diff = await diffVersions(skillPath, oldId, newId);
        if (!diff)
            return { ok: false, error: 'Diff failed' };
        return { ok: true, diff };
    });
    // 对比某个版本和当前文件
    app.get('/api/versions/diff-current', async (req) => {
        const { skillPath, versionId } = req.query;
        const diff = await diffWithCurrent(skillPath, versionId);
        if (!diff)
            return { ok: false, error: 'Diff failed' };
        return { ok: true, diff };
    });
    // 回滚到指定版本
    app.post('/api/versions/rollback', async (req, reply) => {
        const { skillPath, versionId } = req.body;
        let safePath;
        try {
            safePath = await confineExistingPath(skillPath);
        }
        catch (err) {
            reply.status(403);
            return { ok: false, error: err?.message || '路径不合法' };
        }
        const success = await rollback(safePath, versionId);
        if (!success)
            return { ok: false, error: 'Rollback failed' };
        invalidateCache();
        return { ok: true };
    });
    // 删除版本
    app.delete('/api/versions', async (req, reply) => {
        const { skillPath, versionId } = req.query;
        let safePath;
        try {
            // version metadata is keyed by skill path — we still confine, but the
            // path may have been deleted (allow non-existent), so use confinePath.
            safePath = await confinePath(skillPath);
        }
        catch (err) {
            reply.status(403);
            return { ok: false, error: err?.message || '路径不合法' };
        }
        const success = await deleteVersion(safePath, versionId);
        return { ok: success };
    });
}
