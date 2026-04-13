import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fullScan } from './discovery'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

// Mock dependencies
vi.mock('fs/promises')
vi.mock('os', () => ({
  default: {
    homedir: vi.fn().mockReturnValue('/Users/testuser')
  },
  homedir: vi.fn().mockReturnValue('/Users/testuser')
}))
vi.mock('./parser', () => ({
  parseSkillMd: vi.fn().mockResolvedValue({
    frontmatter: { name: 'Mock Skill' },
    content: 'Mock content',
    rawContent: '---\nname: Mock Skill\n---\nMock content'
  }),
  listSkillFiles: vi.fn().mockResolvedValue(['SKILL.md', 'index.js']),
  getSkillMdPath: vi.fn((dir) => path.join(dir, 'SKILL.md'))
}))
vi.mock('./symlink', () => ({
  resolveSymlink: vi.fn((p) => Promise.resolve({ isSymlink: false, realPath: p })),
  identifySource: vi.fn(() => 'local')
}))

// ---------------------------------------------------------------------------
// Helper: build fs mock from a declarative path map
// ---------------------------------------------------------------------------

interface FsEntry {
  isDir?: boolean
  children?: string[]           // directory listing names
  content?: string              // file content for readFile
  throwReaddir?: string         // error message to throw from readdir
  throwStat?: string            // error message to throw from stat
}

function buildFsMocks(map: Record<string, FsEntry>) {
  vi.mocked(fs.stat).mockImplementation(async (p: any) => {
    if (typeof p !== 'string') throw new Error('ENOENT')
    const entry = map[p]
    if (entry?.throwStat) throw new Error(entry.throwStat)
    if (entry) return { isDirectory: () => !!entry.isDir, mtime: new Date(), size: 100 } as any
    // Default: skill subdirs inside a known parent are dirs
    for (const key of Object.keys(map)) {
      const parent = path.dirname(key)
      if (p.length > parent.length && p.startsWith(parent + path.sep) && map[key].isDir) {
        return { isDirectory: () => true, mtime: new Date(), size: 100 } as any
      }
    }
    throw new Error('ENOENT')
  })

  vi.mocked(fs.readdir).mockImplementation(async (p: any) => {
    if (typeof p !== 'string') return []
    const entry = map[p]
    if (entry?.throwReaddir) throw new Error(entry.throwReaddir)
    if (entry?.children) {
      return entry.children.map(name => ({
        name,
        isDirectory: () => map[path.join(p, name)]?.isDir ?? false,
        isFile: () => !(map[path.join(p, name)]?.isDir ?? false),
      })) as any
    }
    return []
  })

  vi.mocked(fs.access).mockImplementation(async (p: any) => {
    if (typeof p !== 'string') throw new Error('ENOENT')
    if (p.endsWith('SKILL.md')) return undefined
    throw new Error('ENOENT')
  })

  vi.mocked(fs.readFile).mockImplementation(async (p: any) => {
    if (typeof p !== 'string') throw new Error('ENOENT')
    // settings.json — default: nothing disabled
    if (p.includes('settings.json')) return JSON.stringify({ permissions: { deny: [] } })
    // plugin config — default: no plugins
    if (p.includes('plugins') && p.endsWith('config.json')) return JSON.stringify({})
    // SKILL.md files
    if (p.endsWith('SKILL.md')) return '---\nname: Mock Skill\n---\nContent'
    throw new Error('ENOENT')
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fullScan', () => {
  const mockHome = '/Users/testuser'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(os.homedir).mockReturnValue(mockHome)
    // Safe defaults — everything missing
    buildFsMocks({})
  })

  // -----------------------------------------------------------------------
  it('should return empty result when no skill directories exist', async () => {
    const result = await fullScan()

    expect(result.skills).toEqual([])
    expect(result.projects).toEqual([])
    expect(result.conflicts).toEqual([])
    expect(result.stats.total).toBe(0)
    expect(result.stats.global).toBe(0)
    expect(result.stats.project).toBe(0)
    // scannedPaths should have entries (one per agent global path) but all non-existent
    expect(result.scannedPaths.every(p => !p.exists)).toBe(true)
  })

  // -----------------------------------------------------------------------
  it('should scan global and project skills and aggregate results', async () => {
    const globalDir = path.join(mockHome, '.claude', 'skills')
    const commonDir = path.join(mockHome, 'Documents')
    const projectDir = path.join(commonDir, 'my-project')
    const projectSkillsDir = path.join(projectDir, '.claude', 'skills')

    buildFsMocks({
      [globalDir]: {
        isDir: true,
        children: ['GlobalSkill'],
      },
      [path.join(globalDir, 'GlobalSkill')]: {
        isDir: true,
        children: ['SKILL.md'],
      },
      [commonDir]: {
        isDir: true,
        children: ['my-project'],
      },
      [projectDir]: {
        isDir: true,
        children: [],
      },
      [projectSkillsDir]: {
        isDir: true,
        children: ['ProjectSkill'],
      },
      [path.join(projectSkillsDir, 'ProjectSkill')]: {
        isDir: true,
        children: ['SKILL.md'],
      },
    })

    const result = await fullScan()

    expect(result.stats.total).toBeGreaterThanOrEqual(2)
    expect(result.scannedPaths.some(p => p.label.startsWith('global:'))).toBe(true)
    expect(result.scannedPaths.some(p => p.label.startsWith('project:'))).toBe(true)
    // project should appear with correct skillCount
    const proj = result.projects.find(p => p.name === 'my-project')
    expect(proj).toBeDefined()
    expect(proj!.skillCount).toBeGreaterThanOrEqual(1)
  })

  // -----------------------------------------------------------------------
  it('should isolate errors in one directory without affecting others', async () => {
    // Two global agent dirs: claude-code succeeds, cursor fails silently
    // scanSkillDir catches readdir errors internally and returns []
    const claudeDir = path.join(mockHome, '.claude', 'skills')
    const cursorDir = path.join(mockHome, '.cursor', 'skills')

    buildFsMocks({
      [claudeDir]: {
        isDir: true,
        children: ['WorkingSkill'],
      },
      [path.join(claudeDir, 'WorkingSkill')]: {
        isDir: true,
        children: ['SKILL.md'],
      },
      [cursorDir]: {
        isDir: true,
        throwReaddir: 'Permission Denied',
      },
    })

    const result = await fullScan()

    // claude-code global should succeed
    const claudeReport = result.scannedPaths.find(p => p.label === 'global:claude-code')
    expect(claudeReport).toBeDefined()
    expect(claudeReport!.count).toBeGreaterThanOrEqual(1)

    // cursor global should exist but yield 0 skills (error swallowed by scanSkillDir)
    const cursorReport = result.scannedPaths.find(p => p.label === 'global:cursor')
    expect(cursorReport).toBeDefined()
    expect(cursorReport!.exists).toBe(true)
    expect(cursorReport!.count).toBe(0)

    // Total should still include the working skill
    expect(result.stats.total).toBeGreaterThanOrEqual(1)
  })

  // -----------------------------------------------------------------------
  it('should scan extra paths from SKILL_HUB_EXTRA_PATHS env var', async () => {
    const extraDir = '/opt/custom-skills'

    buildFsMocks({
      [extraDir]: {
        isDir: true,
        children: ['ExtraSkill'],
      },
      [path.join(extraDir, 'ExtraSkill')]: {
        isDir: true,
        children: ['SKILL.md'],
      },
    })

    process.env.SKILL_HUB_EXTRA_PATHS = extraDir
    try {
      const result = await fullScan()

      const extraReport = result.scannedPaths.find(p => p.label.startsWith('extra:'))
      expect(extraReport).toBeDefined()
      expect(extraReport!.count).toBeGreaterThanOrEqual(1)
    } finally {
      delete process.env.SKILL_HUB_EXTRA_PATHS
    }
  })

  // -----------------------------------------------------------------------
  it('should mark skills as disabled when listed in settings deny list', async () => {
    const globalDir = path.join(mockHome, '.claude', 'skills')

    buildFsMocks({
      [globalDir]: {
        isDir: true,
        children: ['MySkill'],
      },
      [path.join(globalDir, 'MySkill')]: {
        isDir: true,
        children: ['SKILL.md'],
      },
    })

    // Override readFile to return a deny list matching the mocked skill name
    vi.mocked(fs.readFile).mockImplementation(async (p: any) => {
      if (typeof p !== 'string') throw new Error('ENOENT')
      if (p.includes('settings.json')) {
        // parseSkillMd mock returns name 'Mock Skill', so deny that
        return JSON.stringify({ permissions: { deny: ['Skill(Mock Skill)'] } })
      }
      if (p.endsWith('SKILL.md')) return '---\nname: Mock Skill\n---\nContent'
      if (p.includes('plugins') && p.endsWith('config.json')) return JSON.stringify({})
      throw new Error('ENOENT')
    })

    const result = await fullScan()
    const skill = result.skills.find(s => s.name === 'Mock Skill')
    expect(skill).toBeDefined()
    expect(skill!.enabled).toBe(false)
  })

  // -----------------------------------------------------------------------
  it('should detect conflicts when skills share the same name', async () => {
    const globalDir = path.join(mockHome, '.claude', 'skills')
    const commonDir = path.join(mockHome, 'Documents')
    const projectDir = path.join(commonDir, 'my-project')
    const projectSkillsDir = path.join(projectDir, '.claude', 'skills')

    // Both dirs contain an entry; parseSkillMd mock returns name 'Mock Skill' for both
    // so they'll conflict on that name
    const globalSkillDir = path.join(globalDir, 'skill-a')
    const projectSkillDir = path.join(projectSkillsDir, 'skill-b')

    buildFsMocks({
      [globalDir]: { isDir: true, children: ['skill-a'] },
      [globalSkillDir]: { isDir: true, children: ['SKILL.md'] },
      [commonDir]: { isDir: true, children: ['my-project'] },
      [projectDir]: { isDir: true, children: [] },
      [projectSkillsDir]: { isDir: true, children: ['skill-b'] },
      [projectSkillDir]: { isDir: true, children: ['SKILL.md'] },
    })

    const result = await fullScan()

    expect(result.conflicts.length).toBeGreaterThanOrEqual(1)
    // Both get name 'Mock Skill' from the mock, so conflict is on that name
    const conflict = result.conflicts.find(c => c.name === 'Mock Skill')
    expect(conflict).toBeDefined()
    expect(conflict!.skills.length).toBeGreaterThanOrEqual(2)
    for (const s of conflict!.skills) {
      expect(s.hasConflict).toBe(true)
    }
  })
})
