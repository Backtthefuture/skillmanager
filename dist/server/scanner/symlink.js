import fs from 'fs/promises';
export async function resolveSymlink(filePath) {
    try {
        const stat = await fs.lstat(filePath);
        if (stat.isSymbolicLink()) {
            const target = await fs.readlink(filePath);
            const realPath = await fs.realpath(filePath);
            return { isSymlink: true, target, realPath };
        }
        return { isSymlink: false, realPath: filePath };
    }
    catch {
        return { isSymlink: false, realPath: filePath };
    }
}
export function identifySource(realPath, homedir) {
    if (realPath.includes('.newmax/skills'))
        return 'newmax';
    if (realPath.includes('.agents/skills'))
        return 'agents';
    if (realPath.startsWith(homedir))
        return 'local';
    return 'unknown';
}
