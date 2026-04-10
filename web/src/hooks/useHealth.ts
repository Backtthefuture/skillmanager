import { useState, useCallback, useRef } from 'react'

export interface SkillHealth {
  name: string
  path: string
  category: string
  health_score: number
  staleness_level: string
  staleness_days: number
  status_icon: string
  version: string
  description: string
  scores: {
    code_quality: number
    git_sync: number
    runtime_health: number
    activity: number
  }
  issues: string[]
  last_active: string
}

export interface HealthData {
  timestamp: string
  duration_ms: number
  total_checked: number
  summary: {
    healthy: number
    warning: number
    critical: number
  }
  skills: SkillHealth[]
}

export function useHealth() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch('/api/health/results')
      const json = await res.json()
      if (json.ok !== false) {
        setData(json)
        setError(null)
      }
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/health/status')
      const json = await res.json()
      setRunning(json.running)
      return json.running
    } catch {
      return false
    }
  }, [])

  const loadCached = useCallback(async () => {
    setLoading(true)
    await fetchResults()
    await fetchStatus()
    setLoading(false)
  }, [fetchResults, fetchStatus])

  const runCheck = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      await fetch('/api/health/run', { method: 'POST' })
      // Poll for completion
      pollRef.current = setInterval(async () => {
        const stillRunning = await fetchStatus()
        if (!stillRunning) {
          clearInterval(pollRef.current)
          await fetchResults()
          setRunning(false)
        }
      }, 3000)
    } catch (e: any) {
      setError(e.message)
      setRunning(false)
    }
  }, [fetchResults, fetchStatus])

  return { data, loading, error, running, loadCached, runCheck }
}
