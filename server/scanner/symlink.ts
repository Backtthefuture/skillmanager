import fs from 'fs/promises'
import path from 'path'

export interface SymlinkInfo {
  isSymlink: boolean
  target?: string
  realPath: string
}

export async function resolveSymlink(filePath: string): Promise<SymlinkInfo> {
  try {
    const stat = await fs.lstat(filePath)
    // Always canonicalize — a symlink anywhere in the parent chain must be
    // resolved so entries pointing at the same physical skill share one realPath.
    let realPath: string
    try {
      realPath = await fs.realpath(filePath)
    } catch {
      realPath = filePath
    }
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(filePath)
      return { isSymlink: true, target, realPath }
    }
    return { isSymlink: false, realPath }
  } catch {
    return { isSymlink: false, realPath: filePath }
  }
}

export function identifySource(realPath: string, homedir: string): 'newmax' | 'agents' | 'local' | 'unknown' {
  if (realPath.includes('.newmax/skills')) return 'newmax'
  if (realPath.includes('.agents/skills')) return 'agents'
  if (realPath.startsWith(homedir)) return 'local'
  return 'unknown'
}
