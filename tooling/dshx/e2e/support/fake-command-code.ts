import type { Page } from '@playwright/test'
import { createServer } from 'node:http'
import { z } from 'zod'
import { startFakeCommandCode as startFakeServer, type FakeCommandCode } from '../../packages/dshx/src/scratch/fake-command-code.js'

export { FAKE_COMMAND_CODE_MODEL_ID } from '../../packages/dshx/src/scratch/fake-command-code.js'
export type { FakeChatRequest, FakeCommandCode } from '../../packages/dshx/src/scratch/fake-command-code.js'

const fakes = new WeakMap<Page, FakeCommandCode>()
const quotaControls = new WeakMap<Page, { readonly status: Map<string, 200 | 401>; readonly reads: Map<string, number> }>()

/** Read-only loopback metadata proxy: a quota can expire after admission without replacing the saved key. */
export const startControllableQuotaCommandCode = async (page: Page): Promise<FakeCommandCode> => {
  const upstream = await startFakeServer()
  const control = { status: new Map<string, 200 | 401>(), reads: new Map<string, number>() }
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET') {
        response.writeHead(405).end()
        return
      }
      const path = new URL(request.url ?? '/', 'http://127.0.0.1')
      const target = new URL(upstream.baseUrl)
      target.pathname = path.pathname
      target.search = path.search
      const authorization = request.headers.authorization ?? ''
      const key = authorization.replace(/^Bearer /u, '')
      if (path.pathname === '/alpha/billing/credits') {
        control.reads.set(key, (control.reads.get(key) ?? 0) + 1)
        if (control.status.get(key) === 401) {
          response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Synthetic quota login expired' }))
          return
        }
      }
      const result = await fetch(target, { headers: { authorization }, redirect: 'error', signal: AbortSignal.timeout(5_000) })
      response.writeHead(result.status, { 'content-type': 'application/json' }).end(await result.text())
    } catch {
      response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Synthetic metadata proxy unavailable' }))
    }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = z.object({ port: z.number().int().min(1).max(65_535) }).safeParse(server.address())
    if (!address.success) throw new Error('Quota proxy has no loopback port.')
    const fake: FakeCommandCode = {
      ...upstream,
      baseUrl: `http://127.0.0.1:${String(address.data.port)}`,
      close: async () => {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
        await upstream.close()
      },
    }
    quotaControls.set(page, control)
    fakes.set(page, fake)
    return fake
  } catch (cause) {
    server.closeAllConnections()
    server.close()
    await upstream.close()
    throw cause
  }
}

export const setFakeQuotaStatus = (page: Page, key: string, status: 200 | 401): number => {
  const control = quotaControls.get(page)
  if (control === undefined) throw new Error('Controllable quota fixture was not started.')
  control.status.set(key, status)
  return control.reads.get(key) ?? 0
}
export const fakeQuotaReads = (page: Page, key: string): number => quotaControls.get(page)?.reads.get(key) ?? 0

export const startFakeCommandCode = async (page: Page): Promise<FakeCommandCode> => {
  const fake = await startFakeServer()
  fakes.set(page, fake)
  return fake
}

export const fakeCommandCodeFor = (page: Page): FakeCommandCode => {
  const fake = fakes.get(page)
  if (fake === undefined) throw new Error('The fake Command Code server was not started for this scenario.')
  return fake
}

export const stopFakeCommandCode = async (page: Page): Promise<void> => {
  const fake = fakes.get(page)
  if (fake === undefined) return
  fakes.delete(page)
  quotaControls.delete(page)
  await fake.close()
}
