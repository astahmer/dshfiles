import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiProtocolModel } from '../api/common.js'
import { TracerModel } from '../tracing/tracer.js'
import type { JsonValue } from './client.js'
import { DshPlatformError, DshPlatformLaunchUrl } from './client.js'

const responseSchema = z
  .object({
    type: z.literal('server-response'),
    rpcId: z.string(),
    result: z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), value: z.unknown() }).passthrough(),
      z
        .object({
          ok: z.literal(false),
          error: z.object({ code: z.string().optional(), message: z.string() }).passthrough(),
        })
        .passthrough(),
    ]),
  })
  .passthrough()

const outputSchema = z.object({ version: z.number().int(), output: z.unknown() }).passthrough()

export type DshxApiCall = (method: string, input?: JsonValue, signal?: AbortSignal) => Promise<unknown>

export interface DshxApiCallerOptions {
  readonly origin: string
  readonly cookie: string
  readonly packageId: string
  readonly apiId: string
  readonly version: number
  readonly fetch?: typeof fetch
}

const safeMessage = (message: string): string => message.replace(/([?&]token=)[^&\s]*/gi, '$1[redacted]')

/** Calls one versioned DSHX Host API using an existing authenticated native session. */
export const createDshxApiCaller = ({ origin, cookie, packageId, apiId, version, fetch: request = fetch }: DshxApiCallerOptions): DshxApiCall => {
  const channel = ApiProtocolModel.apiChannel(packageId, apiId)
  const tracer = TracerModel.process()
  const call: DshxApiCall = async (method, input, signal) => {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(method)) throw new DshPlatformError('invalid-method', 'DSHX API method names must be plain identifiers.')
    const rpcId = randomUUID()
    const headers = new Headers({ 'content-type': 'application/json', cookie })
    const parent = tracer.traceparent()
    if (parent !== undefined) headers.set('traceparent', parent)
    let response: Response
    try {
      response = await request(origin + '/api/' + channel.slice(1) + '/' + method, {
        method: 'POST',
        redirect: 'error',
        headers,
        body: JSON.stringify({
          type: 'client-request',
          rpcId,
          method: channel.slice(1) + '/' + method,
          payload: input === undefined ? { version } : { version, input },
        }),
        ...(signal !== undefined && { signal }),
      })
    } catch {
      if (signal?.aborted) throw new DshPlatformError('cancelled', 'The DSHX API request was cancelled by the caller.')
      throw new DshPlatformError('api-unreachable', 'The DSHX API request failed. Confirm that the connected DSH runtime is running.')
    }
    if (response.status === 401) throw new DshPlatformError('authentication-expired', 'The DSH session expired. Use the current tokenized launch URL.')
    if (!response.ok) throw new DshPlatformError('api-http-error', 'DSH API returned HTTP ' + response.status + ' for ' + apiId + '/' + method + '.')
    let body: unknown
    try {
      body = JSON.parse(await response.text())
    } catch {
      throw new DshPlatformError('invalid-response', 'DSH API ' + apiId + '/' + method + ' returned invalid JSON.')
    }
    const parsed = responseSchema.safeParse(body)
    if (!parsed.success || parsed.data.rpcId !== rpcId) {
      throw new DshPlatformError('invalid-response', 'DSH API ' + apiId + '/' + method + ' returned an invalid RPC envelope.')
    }
    if (!parsed.data.result.ok) {
      const failure = parsed.data.result.error
      throw new DshPlatformError(failure.code ?? 'remote-error', safeMessage(failure.message))
    }
    const output = outputSchema.safeParse(parsed.data.result.value)
    if (!output.success || output.data.version !== version) {
      throw new DshPlatformError('invalid-response', 'DSH API ' + apiId + '/' + method + ' returned an invalid versioned output.')
    }
    return output.data.output
  }
  return (method, input, signal) =>
    tracer.enabled
      ? tracer.withSpan(
          `${apiId}/${method}`,
          {
            kind: 'client',
            attributes: { 'rpc.system': 'dshx', 'rpc.service': apiId, 'rpc.method': method, 'dshx.plugin.package': packageId, 'dshx.api.remote': true },
          },
          () => call(method, input, signal),
        )
      : call(method, input, signal)
}

/** Authenticates through the tokenized launch URL, then returns a typed API call function. */
export const connectDshxApi = async ({
  url,
  packageId,
  apiId,
  version,
  fetch: request = fetch,
}: {
  readonly url?: string
  readonly packageId: string
  readonly apiId: string
  readonly version: number
  readonly fetch?: typeof fetch
}): Promise<DshxApiCall> => {
  const launchUrl = DshPlatformLaunchUrl.resolveLaunchUrl(url)
  if (launchUrl === undefined)
    throw new DshPlatformError(
      'missing-url',
      'Set DSHX_URL to the tokenized DSH launch URL printed by dsh, or start DSH with dsh-web so it records one in ~/.dsh/runtime/web-url.',
    )
  const parsed = DshPlatformLaunchUrl.loopbackLaunchUrl(launchUrl)
  let exchange: Response
  try {
    exchange = await request(parsed.origin + '/?token=' + encodeURIComponent(parsed.token), { redirect: 'manual' })
  } catch {
    throw new DshPlatformError('connection-failed', 'Could not reach the DSH launch URL. Check that DSH is running and the URL is current.')
  }
  if (!exchange.ok && exchange.status !== 302 && exchange.status !== 303) {
    throw new DshPlatformError('authentication-failed', 'DSH launch authentication failed with HTTP ' + exchange.status + '.')
  }
  const cookie = exchange.headers
    .getSetCookie()
    .map(item => item.split(';', 1)[0])
    .filter(Boolean)
    .join('; ')
  if (!cookie) throw new DshPlatformError('authentication-failed', 'DSH did not issue an authenticated session cookie for the launch URL.')
  return createDshxApiCaller({ origin: parsed.origin, cookie, packageId, apiId, version, fetch: request })
}
