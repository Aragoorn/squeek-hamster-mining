/** Process entry point: `bun run server`. */
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createChainReader } from './chain'
import { loadEnv } from './config'
import { GameDb } from './db'
import { createApp, signerFromKey } from './app'

const env = loadEnv()
const db = new GameDb(env.dbPath)
const signer = signerFromKey(env.signerKey)
const chain = env.hubAddress ? createChainReader(env.rpcUrl, env.hubAddress) : null

if (!signer) console.warn('[server] GAME_SIGNER_PRIVATE_KEY missing: claim vouchers are disabled.')
if (!env.hubAddress) console.warn('[server] VITE_GEM_HUB_ADDRESS missing: onchain features are disabled.')

const app = createApp({ db, signer, hub: env.hubAddress ?? null, chain, trustProxy: env.trustProxy })

const distDir = resolve(process.env.STATIC_DIR ?? 'dist')
const serveStatic = existsSync(join(distDir, 'index.html'))

/** Serves the built web app (production only). Unknown paths fall back to index.html. */
async function staticResponse(pathname: string): Promise<Response> {
  const target = resolve(join(distDir, decodeURIComponent(pathname)))
  const inside = target === distDir || target.startsWith(distDir + sep)
  const file = inside ? Bun.file(target) : null
  if (file && pathname !== '/' && (await file.exists()) && !target.endsWith(sep)) {
    const cache = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    return new Response(file, { headers: { 'cache-control': cache, 'x-content-type-options': 'nosniff' } })
  }
  return new Response(Bun.file(join(distDir, 'index.html')), { headers: { 'cache-control': 'no-cache' } })
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? env.port),
  hostname: process.env.HOST ?? '127.0.0.1',
  maxRequestBodySize: 8 * 1024,
  fetch(req, srv) {
    const url = new URL(req.url)
    if (serveStatic && !url.pathname.startsWith('/api/') && (req.method === 'GET' || req.method === 'HEAD')) {
      return staticResponse(url.pathname).catch(() => new Response('Not found', { status: 404 }))
    }
    return app.handle(req, srv.requestIP(req)?.address ?? 'unknown')
  },
})

const pruner = setInterval(() => db.prune(Date.now()), 10 * 60_000)

function shutdown(): void {
  clearInterval(pruner)
  server.stop()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
console.log(`[server] listening on http://127.0.0.1:${server.port}`)
