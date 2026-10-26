import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { z } from 'zod'

export const probeBrowserCache = async () => {
  const assetCount = 12
  const navigations = 3
  let assetServerHits = 0
  const assetBody = 'window.cacheProbeLoaded = true;\n'.repeat(256)
  const document = `<!doctype html><title>Local cache probe</title>${Array.from({ length: assetCount }, (_, index) => `<script src="/asset-${index}.js"></script>`).join('')}`
  const server = createServer((request, response) => {
    if (/^\/asset-\d+\.js$/.test(request.url ?? '')) {
      assetServerHits += 1
      response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=3600, immutable' })
      response.end(assetBody)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(document)
  })
  let browser
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = z.object({ port: z.number().int().positive() }).parse(server.address())
    const origin = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch()
    const scenarios = []
    for (const mode of ['route-free-controlled', 'routed-functional', 'unrelated-route']) {
      const context = await browser.newContext({ serviceWorkers: 'block' })
      try {
        if (mode === 'unrelated-route') await context.route(`${origin}/api/never`, route => route.fulfill({ json: {} }))
        if (mode === 'routed-functional') {
          await context.route('**/*', route => {
            if (new URL(route.request().url()).origin === origin) return route.continue()
            return route.abort('blockedbyclient')
          })
        }
        const page = await context.newPage()
        const samples = []
        for (let navigation = 0; navigation < navigations; navigation += 1) {
          assetServerHits = 0
          const startedAt = performance.now()
          await page.goto(origin, { waitUntil: 'load', timeout: 15_000 })
          const durationMs = Math.round(performance.now() - startedAt)
          const resources = await page.evaluate(() => {
            const assets = performance.getEntriesByType('resource').filter(entry => entry.name.includes('/asset-'))
            return {
              assetRequests: assets.length,
              assetTransferBytes: assets.reduce((total, entry) => total + entry.transferSize, 0),
              cachedAssets: assets.filter(entry => entry.transferSize === 0).length,
            }
          })
          samples.push({
            phase: navigation === 0 ? 'cold' : 'repeat',
            cacheState: mode === 'route-free-controlled' ? (navigation === 0 ? 'cold' : 'warm') : 'disabled-by-routing',
            navigation: navigation + 1,
            durationMs,
            assetServerHits,
            ...resources,
          })
        }
        scenarios.push({ mode, samples })
      } finally {
        await context.close()
      }
    }
    return { browser: browser.version(), assetCount, navigations, scenarios }
  } finally {
    await browser?.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await probeBrowserCache(), null, 2))
}
