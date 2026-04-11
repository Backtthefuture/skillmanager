import os from 'os';
import { fullScan } from '../scanner/discovery.js';
import { AGENTS } from '../scanner/agents.js';
let cachedResult = null;
export function getCachedResult() {
    return cachedResult;
}
export async function skillRoutes(app) {
    // Trigger full scan
    app.get('/api/scan', async () => {
        cachedResult = await fullScan();
        return cachedResult;
    });
    // Get all skills (with optional filters)
    app.get('/api/skills', async (req) => {
        if (!cachedResult) {
            cachedResult = await fullScan();
        }
        let skills = [...cachedResult.skills];
        const { scope, source, agent, search } = req.query;
        if (scope && scope !== 'all') {
            skills = skills.filter((s) => s.scope === scope);
        }
        if (source && source !== 'all') {
            skills = skills.filter((s) => s.source === source);
        }
        if (agent && agent !== 'all') {
            skills = skills.filter((s) => s.agent === agent);
        }
        if (search) {
            const q = search.toLowerCase();
            skills = skills.filter((s) => s.name.toLowerCase().includes(q) ||
                s.description.toLowerCase().includes(q));
        }
        return { skills, stats: cachedResult.stats };
    });
    // Get single skill detail
    app.get('/api/skills/:id', async (req, reply) => {
        if (!cachedResult) {
            cachedResult = await fullScan();
        }
        const skill = cachedResult.skills.find((s) => s.id === req.params.id);
        if (!skill) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        return skill;
    });
    // Get the agent registry (id/name/icon) — used by the frontend filter UI
    app.get('/api/agents', async () => {
        return AGENTS.map((a) => ({ id: a.id, name: a.name, icon: a.icon }));
    });
    // Get discovered projects
    app.get('/api/projects', async () => {
        if (!cachedResult) {
            cachedResult = await fullScan();
        }
        return cachedResult.projects;
    });
    // Get conflicts
    app.get('/api/conflicts', async () => {
        if (!cachedResult) {
            cachedResult = await fullScan();
        }
        return cachedResult.conflicts;
    });
    // Get stats
    app.get('/api/stats', async () => {
        if (!cachedResult) {
            cachedResult = await fullScan();
        }
        return cachedResult.stats;
    });
    // Diagnostic endpoint — useful for debugging "only found 1 skill" reports
    app.get('/api/debug', async () => {
        if (!cachedResult) {
            cachedResult = await fullScan();
        }
        return {
            version: '0.3.0',
            node: process.version,
            platform: process.platform,
            cwd: process.cwd(),
            homedir: os.homedir(),
            env: {
                SKILL_HUB_EXTRA_PATHS: process.env.SKILL_HUB_EXTRA_PATHS || null,
                PORT: process.env.PORT || null,
            },
            scan: {
                durationMs: cachedResult.durationMs,
                totalSkills: cachedResult.stats.total,
                scannedPaths: cachedResult.scannedPaths,
            },
            stats: cachedResult.stats,
        };
    });
}
export function invalidateCache() {
    cachedResult = null;
}
