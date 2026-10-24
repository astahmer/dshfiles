import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { ApiProtocolModel } from '../api/common.js'
import { BROWSER_TRACES_API } from './browser-protocol.js'
import { BrowserTracingRegistryModel, type BrowserTraceTransport } from './browser-registry.js'

interface ContextLike {
  get(name: string): unknown
}

type Rpc = Pick<ClientConnectionRpc, 'call'>

const isRpc = (value: unknown): value is Rpc => typeof value === 'object' && value !== null && 'call' in value && typeof value.call === 'function'

const rpcOf = (ctx: ContextLike): Rpc | undefined => {
  const connection = ctx.get('connection')
  const rpc = typeof connection === 'object' && connection !== null && 'rpc' in connection ? connection.rpc : undefined
  return isRpc(rpc) ? rpc : undefined
}

/**
 * Calls the Host's browser-traces API straight through the Connection, not through a dshx API client: its own
 * requests must never open a client span or carry a `traceparent`, or exporting would trace itself. `rpc` is resolved
 * per request, so attaching reads no service until the page records its first span.
 */
const transportOf = (rpc: Rpc | (() => Rpc | undefined)): BrowserTraceTransport => {
  const channel = ApiProtocolModel.apiChannel(BROWSER_TRACES_API.owner, BROWSER_TRACES_API.id)
  const resolve = typeof rpc === 'function' ? rpc : () => rpc
  const invoke = async (method: 'status' | 'export', input?: unknown): Promise<unknown> => {
    const current = resolve()
    if (current === undefined) throw new Error('browser traces: no Connection')
    const result = await current.call('/api', `${channel.slice(1)}/${method}`, { version: BROWSER_TRACES_API.version, input })
    if (!result.ok) throw new Error(`browser traces ${method} refused`)
    const envelope = result.value
    return typeof envelope === 'object' && envelope !== null && 'output' in envelope ? envelope.output : undefined
  }
  return { status: () => invoke('status'), export: input => invoke('export', input) }
}

/** Attach the page tracer to this Client's Connection; returns the detach function. */
const connectBrowserTracing = (ctx: ContextLike): (() => void) => BrowserTracingRegistryModel.attach(transportOf(() => rpcOf(ctx)))

export class BrowserTraceTransportModel {
  static readonly connect = connectBrowserTracing
  static readonly fromRpc = transportOf
}
