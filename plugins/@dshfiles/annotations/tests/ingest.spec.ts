import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createIngestHandler, resetIngestRateLimit } from '../src/ingest.js'
import type { AnnotationDraft, AnnotationTarget } from '../src/schema.js'

const target: AnnotationTarget = {
  surface: 'external',
  url: 'http://localhost:3000/',
  selector: 'button.cta',
  tag: 'button',
  rect: { x: 0, y: 0, width: 10, height: 10 },
}

const draft: AnnotationDraft = { kind: 'element', target, note: 'from chrome' }
const token = 'a'.repeat(43)
const origin = `chrome-extension://${'b'.repeat(32)}`

const servers: Server[] = []

afterEach(async () => {
  resetIngestRateLimit()
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => resolve())
        }),
    ),
  )
})

const start = async ({
  allowedOrigins = [],
  ingest = async () => [],
  tokenValue = token,
}: {
  readonly allowedOrigins?: readonly string[]
  readonly ingest?: (input: { readonly drafts: readonly AnnotationDraft[]; readonly extensionOrigin: string }) => Promise<never[]>
  readonly tokenValue?: string
} = {}): Promise<string> => {
  const handler = createIngestHandler({
    token: async () => tokenValue,
    allowedOrigins: () => allowedOrigins,
    ingest: async ({ drafts, extensionOrigin }) => {
      await ingest({ drafts, extensionOrigin })
      return []
    },
  })
  const server = createServer((request, response) => {
    void handler(request, response)
  })
  servers.push(server)
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no loopback port')
  return `http://127.0.0.1:${address.port}`
}

const post = async ({
  base,
  body,
  authorization = `Bearer ${token}`,
  requestOrigin = origin,
}: {
  readonly base: string
  readonly body: string
  readonly authorization?: string
  readonly requestOrigin?: string
}): Promise<Response> =>
  fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization, origin: requestOrigin },
    body,
  })

describe('ingest route', () => {
  it('accepts a valid annotation', async () => {
    const received: unknown[] = []
    const base = await start({
      ingest: async ({ drafts, extensionOrigin }) => {
        received.push({ drafts, extensionOrigin })
        return []
      },
    })
    const response = await post({ base, body: JSON.stringify({ drafts: [draft] }) })
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: 0 })
    expect(received).toHaveLength(1)
  })

  it('rejects a wrong token', async () => {
    const base = await start()
    const response = await post({ base, body: JSON.stringify({ drafts: [draft] }), authorization: 'Bearer nope' })
    expect(response.status).toBe(401)
  })

  it('rejects a non-extension origin', async () => {
    const base = await start()
    const response = await post({ base, body: JSON.stringify({ drafts: [draft] }), requestOrigin: 'https://evil.example' })
    expect(response.status).toBe(403)
  })

  it('rejects an origin outside the allowlist', async () => {
    const base = await start({ allowedOrigins: [`chrome-extension://${'c'.repeat(32)}`] })
    const response = await post({ base, body: JSON.stringify({ drafts: [draft] }) })
    expect(response.status).toBe(403)
  })

  it('rejects an oversize body', async () => {
    const base = await start()
    const response = await post({ base, body: JSON.stringify({ drafts: [draft], pad: 'x'.repeat(70_000) }) })
    expect(response.status).toBe(413)
  })

  it('rejects an invalid body', async () => {
    const base = await start()
    const response = await post({ base, body: JSON.stringify({ drafts: [] }) })
    expect(response.status).toBe(400)
  })

  it('rate-limits one origin', async () => {
    const base = await start()
    const responses = await Promise.all(Array.from({ length: 32 }, () => post({ base, body: JSON.stringify({ drafts: [draft] }) })))
    expect(responses.some(response => response.status === 429)).toBe(true)
  })
})
