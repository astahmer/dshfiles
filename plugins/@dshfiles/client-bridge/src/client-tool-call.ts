import type { ApiCaller, ApiEventHostPayload } from '@dshfiles/dshx/api'
import { traceparent } from '@dshfiles/dshx/tracing'
import { Effect } from 'effect'
import type * as Schema from 'effect/Schema'
import { BridgeLimits, type clientBridgeApi } from './api.js'
import { ClientBridge } from './bridge.js'
import { ClientToolRefused } from './errors.js'
import type { ClientBridgeSettings } from './settings.js'
import { BridgeWindows } from './windows.js'

export type InvokePayload = ApiEventHostPayload<NonNullable<typeof clientBridgeApi.events>['invoke']>

export interface ClientToolCallInput {
  readonly tool: string
  readonly input?: { readonly [key: string]: Schema.Json }
  readonly clientId?: string
  readonly timeoutMs?: number
}

const OPEN_DSH = 'Ask the user to open DSH in a browser (or bring its tab back), then call client_tools_list again.'

/** The thread an Agent caller works in; Host plugins have none. */
export const callerSession = (caller: ApiCaller): string | undefined => (caller.kind === 'agent' ? caller.sessionId : undefined)

/**
 * Run one client tool in a window and wait for its answer, under one `client-tool invoke` span whose context the
 * window continues.
 * @param input - the tool, its input, an optional window and timeout.
 * @param deps - the caller, the live settings and how to publish the invoke event.
 * @returns the window that ran it, the tool and its JSON result.
 */
export const runClientToolCall = Effect.fn('client-tool invoke')(function* (
  input: ClientToolCallInput,
  deps: {
    readonly caller: ApiCaller
    readonly settings: ClientBridgeSettings
    readonly publish: (payload: InvokePayload) => Effect.Effect<void, unknown>
  },
) {
  const { caller, settings } = deps
  yield* Effect.annotateCurrentSpan({ 'dshx.client_tool.name': input.tool, 'dshx.client_tool.caller': caller.kind })
  if (caller.kind === 'client')
    return yield* new ClientToolRefused({
      reason: 'not-agent',
      recovery: 'client_tool_call is for Agents and Host plugins; the page runs its own tools directly.',
    })
  if (!settings.enabled)
    return yield* new ClientToolRefused({
      reason: 'disabled',
      recovery:
        'Client tools are switched off. Ask the user to turn on Settings › Client Bridge › enabled (namespace dshfiles-client-bridge) if they want you to act in their window.',
    })
  const bridge = yield* ClientBridge
  const sessionId = callerSession(caller)
  const picked = BridgeWindows.pick({ windows: yield* bridge.windows, sessionId, tool: input.tool, clientId: input.clientId })
  if (picked.kind === 'no-window') return yield* new ClientToolRefused({ reason: 'no-window', recovery: `No DSH browser window is open. ${OPEN_DSH}` })
  if (picked.kind === 'unknown-window')
    return yield* new ClientToolRefused({
      reason: 'unknown-window',
      recovery: `Window ${picked.clientId} is not open any more. Call client_tools_list for the open windows, or omit clientId.`,
    })
  if (picked.kind === 'unknown-tool')
    return yield* new ClientToolRefused({
      reason: 'unknown-tool',
      recovery: `No open window offers ${input.tool}. It offers: ${picked.window.tools.map(tool => tool.name).join(', ') || 'nothing'}. Call client_tools_list for the exact names; a tool appears once the plugin that owns it is loaded.`,
    })
  const window = picked.window
  yield* Effect.annotateCurrentSpan({
    'dshx.client_tool.window_focused': window.focused,
    'dshx.client_tool.window_shows_thread': sessionId !== undefined && window.sessionId === sessionId,
  })
  const timeoutMs = input.timeoutMs ?? BridgeLimits.defaultTimeoutMs
  const started = yield* bridge.start({ clientId: window.clientId, timeoutMs })
  const parent = yield* Effect.sync(() => traceparent() ?? null)
  yield* deps
    .publish({
      requestId: started.requestId,
      clientId: window.clientId,
      tool: input.tool,
      input: input.input ?? {},
      timeoutMs,
      notify: settings.notify,
      traceparent: parent,
    })
    .pipe(
      Effect.onError(() => started.cancel),
      Effect.mapError(() => new ClientToolRefused({ reason: 'failed', recovery: `The Host could not reach the browser windows. ${OPEN_DSH}` })),
    )
  const result = yield* started.result.pipe(Effect.tapError(error => Effect.annotateCurrentSpan({ 'dshx.client_tool.outcome': error.reason })))
  yield* Effect.annotateCurrentSpan({ 'dshx.client_tool.outcome': 'ok' })
  return { clientId: window.clientId, tool: input.tool, result }
})
