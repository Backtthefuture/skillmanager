import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { skillRoutes } from './routes/skills.js'
import { manageRoutes } from './routes/manage.js'
import { versionRoutes } from './routes/versions.js'
import { similarityRoutes } from './routes/similarity.js'
import { trashRoutes } from './routes/trash.js'
import { syncRoutes } from './routes/sync.js'
import { startWatcher } from './scanner/watcher.js'
import { invalidateCache } from './routes/skills.js'
import { fullScan } from './scanner/discovery.js'
import { purgeExpired as purgeExpiredTrash } from './trash/store.js'
import { registerOriginGuard } from './security.js'
import type { WebSocket } from 'ws'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = Fastify({ logger: false })

// Track the actually-bound origin so CORS + CSRF guards know what to accept.
// The server may fall through to a higher port on EADDRINUSE, so both lists
// are mutable and populated after `listen()` resolves.
const allowedOrigins: string[] = []
function allowedOriginsGetter(): string[] {
  return allowedOrigins
}

await app.register(cors, {
  origin: (origin, cb) => {
    // Same-origin requests from our own UI come through without an Origin
    // header — allow those. Everything else must exactly match an origin we
    // bound to.
    if (!origin) return cb(null, true)
    const ok = allowedOrigins.some((o) => o.toLowerCase() === origin.toLowerCase())
    cb(null, ok)
  },
  credentials: false,
})
registerOriginGuard(app, allowedOriginsGetter)
await app.register(websocket)
await app.register(skillRoutes)
await app.register(manageRoutes)
await app.register(versionRoutes)
await app.register(similarityRoutes)
await app.register(trashRoutes)
await app.register(syncRoutes)

// Health check
app.get('/api/health', async () => ({ status: 'ok' }))

// WebSocket for real-time updates
const wsClients = new Set<WebSocket>()

app.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (socket) => {
    wsClients.add(socket)
    socket.on('close', () => wsClients.delete(socket))
  })
})

function broadcast(data: any) {
  const msg = JSON.stringify(data)
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      ws.send(msg)
    }
  }
}

// Start file watcher
let debounceTimer: ReturnType<typeof setTimeout> | null = null

startWatcher((event) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    invalidateCache()
    broadcast({ type: 'change', event })
  }, 500)
})

// Serve built frontend static files (production mode)
// Try several possible locations for the dist/web directory. Must check both
// index.html AND assets/ so we don't accidentally pick the source web/ dir in
// dev mode — the source index.html references /src/main.tsx which only works
// under vite, and serving it from fastify leaves the page blank.
const candidates = [
  path.resolve(__dirname, '../web'),          // dist/server/ → dist/web/ (production layout)
  path.resolve(__dirname, '../../dist/web'),   // server/ (dev) → project/dist/web/
  path.resolve(process.cwd(), 'dist/web'),     // cwd/dist/web/
]

const staticRoot = candidates.find((p) => {
  try {
    return (
      fs.existsSync(path.join(p, 'index.html')) &&
      fs.existsSync(path.join(p, 'assets'))
    )
  } catch {
    return false
  }
})

if (staticRoot) {
  await app.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
    wildcard: false,
  })

  // SPA fallback: any non-/api, non-/ws route → serve index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      reply.status(404).send({ error: 'Not found' })
      return
    }
    reply.sendFile('index.html')
  })
}

// Startup self-check: warn loudly if frontend is missing
if (!staticRoot) {
  console.warn(
    '\n\x1b[33m⚠️  Frontend build not found. Running in API-only mode.\x1b[0m',
  )
  console.warn(
    '   Looked in:\n   - ' + candidates.join('\n   - '),
  )
  console.warn('   Run `npm run build` in the package directory.\n')
}

// Try a range of ports on EADDRINUSE so a stale process doesn't brick startup.
async function listenWithRetry(startPort: number): Promise<number> {
  const maxAttempts = 5
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i
    try {
      await app.listen({ port, host: '127.0.0.1' })
      return port
    } catch (err: any) {
      if (err?.code === 'EADDRINUSE' && i < maxAttempts - 1) {
        console.warn(`\x1b[33m⚠️  Port ${port} in use, trying ${port + 1}...\x1b[0m`)
        continue
      }
      throw err
    }
  }
  throw new Error(`All ports ${startPort}-${startPort + maxAttempts - 1} in use`)
}

const basePort = parseInt(process.env.PORT || '3456')

try {
  const actualPort = await listenWithRetry(basePort)
  const url = `http://localhost:${actualPort}`

  // Register the origins we accept for CORS + mutating requests. Both the
  // loopback IP and the `localhost` hostname are legitimate: browsers open
  // the auto-launched URL, `fetch()` from the UI, and user-pasted links all
  // route to the same server but send different Origin headers.
  allowedOrigins.push(
    `http://localhost:${actualPort}`,
    `http://127.0.0.1:${actualPort}`,
  )

  // Purge expired trash entries on startup (best-effort, non-blocking failures)
  try {
    const removed = await purgeExpiredTrash()
    if (removed > 0) {
      console.log(`\x1b[90m🗑  Purged ${removed} expired trash entr${removed === 1 ? 'y' : 'ies'}\x1b[0m`)
    }
  } catch {}

  // Run an initial scan so the banner shows real numbers
  let scanSummary = ''
  try {
    const result = await fullScan()
    const paths = result.scannedPaths
    const foundPaths = paths.filter((p) => p.count > 0)
    scanSummary =
      `\x1b[32m✅ Found ${result.stats.total} skills\x1b[0m ` +
      `(${foundPaths.length}/${paths.length} locations, ${result.durationMs}ms)`
    if (result.stats.total === 0) {
      scanSummary += '\n\x1b[33m⚠️  No skills found. Run `curl ' + url + '/api/debug` to see scanned paths.\x1b[0m'
    }
  } catch (e: any) {
    scanSummary = `\x1b[31m❌ Initial scan failed: ${e?.message || e}\x1b[0m`
  }

  console.log(`\n🚀 Claude Skill Hub running at \x1b[36m${url}\x1b[0m`)
  if (staticRoot) {
    console.log(`🌐 Web UI:   \x1b[36m${url}\x1b[0m`)
  }
  console.log(`🔍 Debug:    \x1b[36m${url}/api/debug\x1b[0m`)
  console.log(scanSummary)
  console.log(`👀 File watcher active`)
  console.log(`\x1b[90m💡 下次启动直接敲: \x1b[0m\x1b[36mskill-hub\x1b[0m\x1b[90m  (或访问 ${url})\x1b[0m\n`)

  if (staticRoot && process.env.SKILL_HUB_NO_OPEN !== '1') {
    const { exec } = await import('child_process')
    const cmd = process.platform === 'darwin' ? 'open'
              : process.platform === 'win32' ? 'start'
              : 'xdg-open'
    exec(`${cmd} ${url}`, () => {})
  }
} catch (err) {
  console.error('\x1b[31m❌ Failed to start server:\x1b[0m', err)
  process.exit(1)
}
