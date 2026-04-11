import { useState, useCallback } from 'react'
import type { AgentId } from '../agents'

export interface Skill {
  id: string
  name: string
  description: string
  scope: 'global' | 'project' | 'plugin'
  agent: AgentId
  source: 'local' | 'newmax' | 'agents' | 'symlink' | 'unknown'
  path: string
  realPath: string
  symlinkTarget?: string
  projectName?: string
  projectPath?: string
  frontmatter: Record<string, any>
  content: string
  files: string[]
  enabled: boolean
  hasConflict: boolean
  lastModified: string
}

export interface Stats {
  total: number
  global: number
  project: number
  bySource: Record<string, number>
  byAgent: Record<string, number>
}

export interface Project {
  name: string
  path: string
  skillCount: number
}

export interface ConflictGroup {
  name: string
  skills: Skill[]
}

export function useSkills() {
  const [allSkills, setAllSkills] = useState<Skill[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, global: 0, project: 0, bySource: {}, byAgent: {} })
  const [projects, setProjects] = useState<Project[]>([])
  const [conflicts, setConflicts] = useState<ConflictGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/scan')
      if (!res.ok) throw new Error('Scan failed')
      const data = await res.json()
      setAllSkills(data.skills)
      setSkills(data.skills)
      setStats(data.stats)
      setProjects(data.projects)
      setConflicts(data.conflicts)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const filterSkills = useCallback(
    (opts: { scope?: string; source?: string; agent?: string; search?: string; project?: string; conflictOnly?: boolean }) => {
      let filtered = [...allSkills]

      if (opts.scope && opts.scope !== 'all') {
        filtered = filtered.filter((s) => s.scope === opts.scope)
      }
      if (opts.source && opts.source !== 'all') {
        filtered = filtered.filter((s) => s.source === opts.source)
      }
      if (opts.agent && opts.agent !== 'all') {
        filtered = filtered.filter((s) => s.agent === opts.agent)
      }
      if (opts.project && opts.project !== 'all') {
        filtered = filtered.filter((s) => s.projectPath === opts.project || (opts.project === 'global' && s.scope === 'global'))
      }
      if (opts.conflictOnly) {
        filtered = filtered.filter((s) => s.hasConflict)
      }
      if (opts.search) {
        const q = opts.search.toLowerCase()
        filtered = filtered.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.source.toLowerCase().includes(q),
        )
      }

      setSkills(filtered)
    },
    [allSkills],
  )

  return {
    allSkills,
    skills,
    stats,
    projects,
    conflicts,
    loading,
    error,
    scan,
    filterSkills,
  }
}
