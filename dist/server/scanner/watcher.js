import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { allAgentGlobalAbsPaths } from './agents.js';
const homedir = os.homedir();
let watcher = null;
export function startWatcher(callback) {
    if (watcher)
        return;
    const watchPaths = [
        ...allAgentGlobalAbsPaths(homedir).map((x) => x.path),
        path.join(homedir, '.newmax', 'skills'),
    ];
    // Only watch paths that exist
    const validPaths = watchPaths.filter((p) => {
        try {
            fs.statSync(p);
            return true;
        }
        catch {
            return false;
        }
    });
    if (validPaths.length === 0)
        return;
    watcher = chokidar.watch(validPaths, {
        depth: 2,
        ignoreInitial: true,
        persistent: true,
        followSymlinks: true,
    });
    watcher
        .on('add', (p) => callback({ type: 'add', path: p }))
        .on('change', (p) => callback({ type: 'change', path: p }))
        .on('unlink', (p) => callback({ type: 'unlink', path: p }))
        .on('addDir', (p) => callback({ type: 'addDir', path: p }))
        .on('unlinkDir', (p) => callback({ type: 'unlinkDir', path: p }));
}
export function stopWatcher() {
    if (watcher) {
        watcher.close();
        watcher = null;
    }
}
