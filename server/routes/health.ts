/**
 * Health Check API Routes
 * Bridges the Python health checker with the Web UI.
 */
import type { FastifyInstance } from 'fastify'
import { getCachedResult, runCheck, isRunning } from '../bridge/checker.js'

export async function healthRoutes(app: FastifyInstance) {
  // Get cached health check results
  app.get('/api/health/results', async () => {
    const result = await getCachedResult()
    if (!result) {
      return { ok: false, error: 'No check results available. Run a check first.' }
    }
    return { ok: true, ...result }
  })

  // Get single skill health detail
  app.get<{
    Params: { name: string }
  }>('/api/health/skill/:name', async (req, reply) => {
    const result = await getCachedResult()
    if (!result) {
      return reply.status(404).send({ ok: false, error: 'No check results available' })
    }
    const skill = result.skills.find((s) => s.name === req.params.name)
    if (!skill) {
      return reply.status(404).send({ ok: false, error: 'Skill not found in check results' })
    }
    return { ok: true, skill }
  })

  // Get check status
  app.get('/api/health/status', async () => {
    return { running: isRunning() }
  })

  // Trigger a new check run
  app.post('/api/health/run', async () => {
    if (isRunning()) {
      return { ok: false, error: 'A check is already running' }
    }

    // Run async — don't await (it can take minutes)
    runCheck((msg) => {
      // Progress messages could be broadcast via WebSocket in the future
      console.log(`[checker] ${msg}`)
    }).then((result) => {
      console.log(
        `[checker] Done: ${result.total_checked} skills, ` +
        `${result.summary.healthy} healthy, ` +
        `${result.summary.warning} warning, ` +
        `${result.summary.critical} critical`
      )
    }).catch((err) => {
      console.error(`[checker] Failed:`, err.message)
    })

    return { ok: true, message: 'Check started' }
  })
}
