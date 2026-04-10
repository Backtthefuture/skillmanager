/**
 * Python Checker Bridge
 * Spawns the Python health checker and reads its JSON output.
 */
import { spawn } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../..')
const dataDir = path.join(projectRoot, 'data')
const cacheFile = path.join(dataDir, 'last-check.json')
const checkerScript = path.join(projectRoot, 'checker', 'main.py')

export interface SkillHealthResult {
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

export interface CheckResult {
  timestamp: string
  duration_ms: number
  total_checked: number
  summary: {
    healthy: number
    warning: number
    critical: number
  }
  skills: SkillHealthResult[]
}

let runningProcess: ReturnType<typeof spawn> | null = null

export async function getCachedResult(): Promise<CheckResult | null> {
  try {
    const raw = await fs.readFile(cacheFile, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function isRunning(): boolean {
  return runningProcess !== null
}

export async function runCheck(
  onProgress?: (msg: string) => void,
): Promise<CheckResult> {
  if (runningProcess) {
    throw new Error('A check is already running')
  }

  await fs.mkdir(dataDir, { recursive: true })

  return new Promise((resolve, reject) => {
    const child = spawn('python3', [checkerScript, '--json'], {
      cwd: projectRoot,
      env: { ...process.env, PYTHONPATH: path.join(projectRoot, 'checker') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    runningProcess = child
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      // Forward progress lines (non-JSON) to the callback
      for (const line of text.split('\n')) {
        if (line.trim() && !line.startsWith('{') && !line.startsWith('[')) {
          onProgress?.(line.trim())
        }
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', async (code) => {
      runningProcess = null

      if (code !== 0) {
        reject(new Error(`Checker exited with code ${code}: ${stderr}`))
        return
      }

      try {
        // The JSON output is in data/last-check.json (written by Python)
        const result = await getCachedResult()
        if (result) {
          resolve(result)
        } else {
          // Fallback: try parsing stdout
          const jsonStart = stdout.indexOf('{')
          if (jsonStart >= 0) {
            const parsed = JSON.parse(stdout.slice(jsonStart))
            await fs.writeFile(cacheFile, JSON.stringify(parsed, null, 2))
            resolve(parsed)
          } else {
            reject(new Error('No JSON output from checker'))
          }
        }
      } catch (e: any) {
        reject(new Error(`Failed to parse checker output: ${e.message}`))
      }
    })

    child.on('error', (err) => {
      runningProcess = null
      reject(new Error(`Failed to spawn python3: ${err.message}`))
    })
  })
}
