/**
 * Skill Trash (Recycle Bin)
 *
 * 设计：软删除 → ~/.skill-hub/trash/<id>/
 *   - 普通目录：整个 skill 目录被 rename 进 trash/<id>/payload/
 *   - 符号链接：不搬运实际文件，只在 meta 里记录 target，还原时重建 symlink
 *   - meta: trash/<id>/.trash-meta.json
 *   - 过期策略：7 天 TTL，懒清理（列表接口和启动时触发 purge）
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
function trashRoot() {
    // Read HOME lazily so tests can override process.env.HOME between calls.
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    return path.join(home, '.skill-hub', 'trash');
}
export const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function newId() {
    const now = Date.now().toString(36);
    const rand = crypto.randomBytes(4).toString('hex');
    return `${now}-${rand}`;
}
async function ensureRoot() {
    await fs.mkdir(trashRoot(), { recursive: true });
}
function entryDir(id) {
    return path.join(trashRoot(), id);
}
function metaPath(id) {
    return path.join(entryDir(id), '.trash-meta.json');
}
function payloadPath(id) {
    return path.join(entryDir(id), 'payload');
}
/**
 * Move a directory into the trash (or restore one back) with Windows-aware
 * fallbacks. Node's `fs.rename` surfaces EPERM/EBUSY/EACCES on Windows any
 * time the source directory contains a file held open by another process —
 * Claude Code watching ~/.claude/skills/, OneDrive syncing, antivirus
 * scanning, VS Code previewing. These locks are typically transient
 * (< 1 second), so we retry with backoff, then fall back to a recursive
 * copy + remove which only needs read access on the source and doesn't
 * need exclusive handles.
 *
 * Error messages on final failure include a hint list so Windows users
 * don't see a bare `EPERM` with no direction.
 */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function windowsHint() {
    if (process.platform !== 'win32')
        return '';
    return ('\n\n提示:Windows 上通常是文件被其他进程占用。常见原因:\n' +
        '  1. Claude Code / Codex / Cursor 客户端仍在运行 — 请在任务管理器里彻底退出\n' +
        '  2. VS Code 打开了这个 skill 的文件\n' +
        '  3. OneDrive / 坚果云 正在同步 — 请暂停同步后重试\n' +
        '  4. 360 / 火绒 / Windows Defender 正在扫描目录\n' +
        '  5. Windows Search 索引服务持有文件句柄\n' +
        '关闭相关软件后再试一次;如果仍然失败,可以在资源管理器里手动删除。');
}
async function renameWithFallback(src, dest) {
    // Fast path: plain rename with retries for transient Windows locks.
    const delays = [0, 80, 200, 450]; // ms; total ~730ms worst case
    let lastErr = null;
    for (let i = 0; i < delays.length; i++) {
        if (delays[i] > 0)
            await sleep(delays[i]);
        try {
            await fs.rename(src, dest);
            return;
        }
        catch (err) {
            lastErr = err;
            if (err?.code === 'EXDEV')
                break; // cross-device — skip retries, go straight to fallback
            if (!RETRYABLE_RENAME_CODES.has(err?.code))
                throw err;
        }
    }
    // Fallback: recursive copy + remove. Works across devices and doesn't
    // need exclusive access to the source directory.
    try {
        await copyDir(src, dest);
    }
    catch (err) {
        const base = lastErr?.message || err?.message || 'copy failed';
        throw new Error(`${base}${windowsHint()}`);
    }
    try {
        // maxRetries lets fs.rm itself handle short-lived Windows locks during cleanup
        await fs.rm(src, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    catch (err) {
        // Source copy succeeded but cleanup failed — surface a specific message so
        // the user knows the file was copied (data is safe) but the original
        // still exists and needs manual cleanup.
        throw new Error(`文件已复制到回收站,但原路径清理失败: ${err?.message || err}\n` +
            `源路径:${src}\n` +
            `请在资源管理器里手动删除上面这个目录。${windowsHint()}`);
    }
}
async function readMeta(id) {
    try {
        const raw = await fs.readFile(metaPath(id), 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function writeMeta(meta) {
    await fs.writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf-8');
}
async function dirSize(dir) {
    let total = 0;
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                total += await dirSize(full);
            }
            else if (e.isFile()) {
                try {
                    const st = await fs.stat(full);
                    total += st.size;
                }
                catch { }
            }
        }
    }
    catch { }
    return total;
}
function inferScope(skillPath) {
    const home = os.homedir();
    const globalRoot = path.join(home, '.claude', 'skills');
    if (skillPath.startsWith(globalRoot + path.sep) || skillPath === globalRoot) {
        return { scope: 'global' };
    }
    // Project skills live at <project>/.claude/skills/<name>
    const marker = path.sep + '.claude' + path.sep + 'skills' + path.sep;
    const idx = skillPath.indexOf(marker);
    if (idx >= 0) {
        return { scope: 'project', projectPath: skillPath.slice(0, idx) };
    }
    return { scope: 'unknown' };
}
/**
 * 将 skill 移入回收站。返回 trash 条目元信息。
 */
export async function moveToTrash(skillPath, skillName) {
    await ensureRoot();
    const stat = await fs.lstat(skillPath);
    const id = newId();
    const dir = entryDir(id);
    await fs.mkdir(dir, { recursive: true });
    const now = new Date();
    const expires = new Date(now.getTime() + TRASH_TTL_MS);
    const { scope, projectPath } = inferScope(skillPath);
    const name = skillName || path.basename(skillPath);
    if (stat.isSymbolicLink()) {
        const target = await fs.readlink(skillPath);
        // 先写 meta，成功后再 unlink 原链接，避免中途失败丢信息
        const meta = {
            id,
            skillName: name,
            originalPath: skillPath,
            scope,
            projectPath,
            isSymlink: true,
            symlinkTarget: target,
            deletedAt: now.toISOString(),
            expiresAt: expires.toISOString(),
        };
        await writeMeta(meta);
        await fs.unlink(skillPath);
        return meta;
    }
    // 普通目录：rename 到 payload/。Windows 上需要重试 + cp 兜底(见 renameWithFallback)
    const dest = payloadPath(id);
    await renameWithFallback(skillPath, dest);
    const size = await dirSize(dest).catch(() => 0);
    const meta = {
        id,
        skillName: name,
        originalPath: skillPath,
        scope,
        projectPath,
        isSymlink: false,
        deletedAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        sizeBytes: size,
    };
    await writeMeta(meta);
    return meta;
}
/**
 * 列出回收站条目（顺便触发过期清理）
 */
export async function listTrash() {
    await ensureRoot();
    await purgeExpired();
    const entries = [];
    let dirs = [];
    try {
        dirs = await fs.readdir(trashRoot());
    }
    catch {
        return entries;
    }
    const nowMs = Date.now();
    for (const id of dirs) {
        const meta = await readMeta(id);
        if (!meta)
            continue;
        const expiresMs = new Date(meta.expiresAt).getTime();
        const daysRemaining = Math.max(0, Math.ceil((expiresMs - nowMs) / (24 * 60 * 60 * 1000)));
        entries.push({ ...meta, daysRemaining });
    }
    entries.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
    return entries;
}
/**
 * 还原一个条目到原位置。
 * - 若目标已存在且 force=false → 抛 TrashConflictError
 * - 若 force=true → 先把目标移进新 trash 条目（保底），再还原
 */
export class TrashConflictError extends Error {
    targetPath;
    constructor(targetPath) {
        super(`目标位置已存在：${targetPath}`);
        this.targetPath = targetPath;
        this.name = 'TrashConflictError';
    }
}
export class TrashNotFoundError extends Error {
    constructor(id) {
        super(`回收站条目不存在：${id}`);
        this.name = 'TrashNotFoundError';
    }
}
export async function restoreFromTrash(id, force = false) {
    const meta = await readMeta(id);
    if (!meta)
        throw new TrashNotFoundError(id);
    // 检查目标路径冲突
    let targetExists = false;
    try {
        await fs.lstat(meta.originalPath);
        targetExists = true;
    }
    catch { }
    if (targetExists) {
        if (!force)
            throw new TrashConflictError(meta.originalPath);
        // force：把目标先扔进回收站作为保底
        await moveToTrash(meta.originalPath, meta.skillName);
    }
    // 确保父目录存在
    await fs.mkdir(path.dirname(meta.originalPath), { recursive: true });
    if (meta.isSymlink && meta.symlinkTarget) {
        await fs.symlink(meta.symlinkTarget, meta.originalPath);
    }
    else {
        const src = payloadPath(id);
        await renameWithFallback(src, meta.originalPath);
    }
    // 清理 trash 条目目录
    await fs.rm(entryDir(id), { recursive: true, force: true });
    return meta;
}
/**
 * 永久删除一个条目
 */
export async function purgeOne(id) {
    const dir = entryDir(id);
    try {
        await fs.rm(dir, { recursive: true, force: true });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 扫描并删除所有已过期条目
 */
export async function purgeExpired() {
    await ensureRoot();
    let dirs = [];
    try {
        dirs = await fs.readdir(trashRoot());
    }
    catch {
        return 0;
    }
    const now = Date.now();
    let removed = 0;
    for (const id of dirs) {
        const meta = await readMeta(id);
        if (!meta) {
            // 坏掉的条目（没 meta）直接清理
            await fs.rm(entryDir(id), { recursive: true, force: true }).catch(() => { });
            continue;
        }
        if (new Date(meta.expiresAt).getTime() <= now) {
            await fs.rm(entryDir(id), { recursive: true, force: true }).catch(() => { });
            removed++;
        }
    }
    return removed;
}
async function copyDir(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isSymbolicLink()) {
            const target = await fs.readlink(s);
            await fs.symlink(target, d);
        }
        else if (entry.isDirectory()) {
            await copyDir(s, d);
        }
        else if (entry.isFile()) {
            await fs.copyFile(s, d);
        }
    }
}
