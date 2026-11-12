import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import * as Schema from 'effect/Schema'
import { decodeJson } from '../json.js'
import { SetupPlan, type ApplyEvent, type SetupPlanResult, type SetupRequest, type SetupStateView } from './setup-plan.js'

/** What the server answers on the authenticated API, with bodies already decoded; a test may provide another. */
export interface SetupApi {
  readonly state: () => Promise<SetupStateView>
  readonly plan: (request: SetupRequest) => Promise<SetupPlanResult>
  /** Streams NDJSON events through `emit`; resolves when the last event was emitted. */
  readonly apply: (input: { readonly request: SetupRequest; readonly hash: string }, emit: (event: ApplyEvent) => void) => Promise<void>
}

interface ApiProblem {
  readonly code: string
  readonly message: string
  readonly hint: string
}

type ApiReply =
  | { readonly ok: true; readonly data: SetupStateView | SetupPlanResult | Readonly<Record<string, never>> }
  | { readonly ok: false; readonly error: ApiProblem }

export interface SetupServer {
  /** The URL to open: the one-time token rides in the fragment, which browsers never send to a server. */
  readonly url: string
  readonly port: number
  readonly close: () => Promise<void>
  /** Settles when the server stopped: shutdown from the page, idle timeout or `close()`. */
  readonly closed: Promise<void>
}

export class SetupApiError extends Error {
  readonly code: string
  readonly hint: string
  readonly status: number
  constructor(input: { readonly code: string; readonly message: string; readonly hint: string; readonly status: number }) {
    super(input.message)
    this.name = 'SetupApiError'
    this.code = input.code
    this.hint = input.hint
    this.status = input.status
  }
}

const COOKIE = 'dshx_setup'
const BODY_LIMIT = 64 * 1024
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
])
const sessionSchema = Schema.Struct({ token: Schema.String })
const emptySchema = Schema.Struct({})
const securityHeaders = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}

const sameSecret = (expected: string, given: string | undefined): boolean => {
  if (given === undefined) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(given)
  return left.length === right.length && timingSafeEqual(left, right)
}

const cookieValue = (header: string | undefined): string | undefined =>
  header
    ?.split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)

/** Read a JSON body of at most 64 KB and decode it with its schema: the API's one parse boundary. */
const readBody = async <S extends Schema.ConstraintDecoder<unknown>>(request: IncomingMessage, schema: S): Promise<S['Type']> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > BODY_LIMIT) throw new SetupApiError({ code: 'too-large', message: 'The request body is too large.', hint: 'Send at most 64 KB.', status: 413 })
    chunks.push(buffer)
  }
  try {
    return decodeJson(schema, Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new SetupApiError({ code: 'usage', message: 'The request body is malformed.', hint: 'Reload the page.', status: 400 })
  }
}

const sendJson = (response: ServerResponse, status: number, body: ApiReply, headers: Readonly<Record<string, string>> = {}): void => {
  response.writeHead(status, { ...securityHeaders, ...headers, 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

const sendError = (response: ServerResponse, error: SetupApiError): void =>
  sendJson(response, error.status, { ok: false, error: { code: error.code, message: error.message, hint: error.hint } })

/**
 * The loopback server behind `dshx setup`: bound to 127.0.0.1 only, a one-time 256-bit token exchanged for an
 * HttpOnly SameSite=Strict cookie, Host and Origin checked on every request (DNS rebinding, CSRF), JSON bodies only,
 * one apply at a time, and a shutdown after `idleMs` without a request.
 */
const startSetupServer = async (input: {
  readonly api: SetupApi
  readonly staticRoot: string
  readonly port?: number
  readonly idleMs?: number
}): Promise<SetupServer> => {
  const token = randomBytes(32).toString('base64url')
  const session = randomBytes(32).toString('base64url')
  let tokenUsed = false
  let applying = false
  let port = 0
  let idleTimer: NodeJS.Timeout | undefined
  let markClosed = (): void => undefined
  const closed = new Promise<void>(resolveClosed => {
    markClosed = resolveClosed
  })

  const allowedHosts = (): readonly string[] => [`127.0.0.1:${String(port)}`, `localhost:${String(port)}`]
  const allowedOrigins = (): readonly string[] => allowedHosts().map(host => `http://${host}`)

  const guard = (request: IncomingMessage): void => {
    if (!allowedHosts().includes(request.headers.host ?? ''))
      throw new SetupApiError({ code: 'host', message: 'This server answers only on 127.0.0.1.', hint: 'Open the URL dshx setup printed.', status: 421 })
    const origin = request.headers.origin
    if (origin !== undefined && !allowedOrigins().includes(origin))
      throw new SetupApiError({ code: 'origin', message: 'Requests from another site are refused.', hint: 'Open the URL dshx setup printed.', status: 403 })
    const site = request.headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin' && site !== 'none')
      throw new SetupApiError({ code: 'origin', message: 'Requests from another site are refused.', hint: 'Open the URL dshx setup printed.', status: 403 })
  }

  const requireJson = (request: IncomingMessage): void => {
    if (!(request.headers['content-type'] ?? '').startsWith('application/json'))
      throw new SetupApiError({ code: 'usage', message: 'Send JSON.', hint: 'Set content-type: application/json.', status: 415 })
  }

  const requireSession = (request: IncomingMessage): void => {
    if (!sameSecret(session, cookieValue(request.headers.cookie)))
      throw new SetupApiError({
        code: 'unauthorized',
        message: 'This page is not signed in to dshx setup.',
        hint: 'Open the URL dshx setup printed, in the same browser.',
        status: 401,
      })
  }

  const serveStatic = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
    const relativePath = normalize(pathname === '/' ? 'index.html' : pathname.slice(1))
    const file = join(input.staticRoot, relativePath)
    const inside = file.startsWith(`${input.staticRoot}${sep}`) && !relativePath.startsWith('..')
    const target = inside && existsSync(file) ? file : join(input.staticRoot, 'index.html')
    if (!existsSync(target)) {
      sendJson(response, 503, { ok: false, error: { code: 'missing-ui', message: 'The setup page is not built.', hint: 'Run pnpm --dir tooling/dshx build.' } })
      return
    }
    response.writeHead(200, { ...securityHeaders, 'content-type': contentTypes.get(extname(target)) ?? 'application/octet-stream' })
    response.end(await readFile(target))
  }

  const stop = async (): Promise<void> => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    await new Promise<void>(resolveStop => {
      server.close(() => resolveStop())
      server.closeAllConnections()
    })
    markClosed()
  }

  const touch = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => void stop(), input.idleMs ?? 30 * 60_000)
    idleTimer.unref()
  }

  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    guard(request)
    touch()
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (!path.startsWith('/api/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        throw new SetupApiError({ code: 'method', message: 'Only GET serves the page.', hint: 'Use GET.', status: 405 })
      await serveStatic(request, response)
      return
    }
    if (path === '/api/session' && request.method === 'POST') {
      requireJson(request)
      const body = await readBody(request, sessionSchema)
      if (tokenUsed || !sameSecret(token, body.token))
        throw new SetupApiError({
          code: 'unauthorized',
          message: 'This setup link was already used or is wrong.',
          hint: 'Stop dshx setup and start it again for a new link.',
          status: 401,
        })
      tokenUsed = true
      sendJson(response, 200, { ok: true, data: {} }, { 'set-cookie': `${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/` })
      return
    }
    requireSession(request)
    if (path === '/api/state' && request.method === 'GET') {
      sendJson(response, 200, { ok: true, data: await input.api.state() })
      return
    }
    if (request.method !== 'POST') throw new SetupApiError({ code: 'method', message: 'Use POST.', hint: 'Use POST.', status: 405 })
    requireJson(request)
    if (path === '/api/plan') {
      sendJson(response, 200, { ok: true, data: await input.api.plan(await readBody(request, SetupPlan.requestSchema)) })
      return
    }
    if (path === '/api/apply') {
      if (applying)
        throw new SetupApiError({ code: 'busy', message: 'Another apply is running.', hint: 'Wait for it to finish, then review again.', status: 409 })
      const body = await readBody(request, SetupPlan.applySchema)
      applying = true
      response.writeHead(200, { ...securityHeaders, 'content-type': 'application/x-ndjson; charset=utf-8' })
      try {
        await input.api.apply(body, event => response.write(`${JSON.stringify(event)}\n`))
      } finally {
        applying = false
        response.end()
      }
      return
    }
    if (path === '/api/shutdown') {
      await readBody(request, emptySchema)
      sendJson(response, 200, { ok: true, data: {} })
      response.once('finish', () => void stop())
      return
    }
    throw new SetupApiError({ code: 'not-found', message: `No endpoint ${path}.`, hint: 'Use state, plan, apply or shutdown.', status: 404 })
  }

  const server = createServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end()
        return
      }
      if (error instanceof SetupApiError) {
        sendError(response, error)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      sendError(response, new SetupApiError({ code: 'failed', message, hint: 'Check the terminal running dshx setup.', status: 500 }))
    })
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(input.port ?? 0, '127.0.0.1', () => {
      const address = server.address()
      port = typeof address === 'object' && address !== null ? address.port : 0
      resolveListen()
    })
  })
  touch()
  return { url: `http://127.0.0.1:${String(port)}/#t=${token}`, port, close: stop, closed }
}

/** `dshx setup`'s local web server. */
export class SetupHttp {
  static readonly start = startSetupServer
}
