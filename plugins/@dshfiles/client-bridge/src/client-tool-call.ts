import type { ApiCaller, ApiEventHostPayload } from '@dshfiles/dshx/api'
import { traceparent } from '@dshfiles/dshx/tracing'
import { Effect } from 'effect'
import type * as Schema from 'effect/Schema'
import { BridgeLimits, type ClientToolStep, type clientBridgeApi } from './api.js'
import { ClientBridge, type Completion } from './bridge.js'
import { ClientToolRefused } from './errors.js'
import type { ClientBridgeSettings } from './settings.js'
import { BridgeWindows } from './windows.js'

export type InvokePayload = ApiEventHostPayload<NonNullable<typeof clientBridgeApi.events>['invoke']>

export interface ClientToolCallInput {
  readonly tool?: string
  readonly input?: { readonly [key: string]: Schema.Json }
  readonly steps?: readonly ClientToolStep[]
  readonly clientId?: string
  readonly timeoutMs?: number
}

export interface ClientToolCallOutput {
  readonly clientId: string
  readonly tool?: string
  readonly result?: Schema.Json
  readonly steps?: readonly { readonly tool: string; readonly result: Schema.Json }[]
}

const OPEN_DSH = 'Ask the user to open DSH in a browser (or bring its tab back), then call client_tools_list again.'
/** How much of the steps that ran a failure message quotes. */
const MAX_DONE_CHARS = 1_000

/** The thread an Agent caller works in; Host plugins have none. */
export const callerSession = (caller: ApiCaller): string | undefined => (caller.kind === 'agent' ? caller.sessionId : undefined)

/** One call is a chain of one step. */
const stepsOf = (input: ClientToolCallInput): readonly ClientToolStep[] =>
  input.steps ?? (input.tool === undefined ? [] : [{ tool: input.tool, ...(input.input !== undefined && { input: input.input }) }])

/** The Agent's error for a chain the window stopped: which step, why, and what already happened in the page. */
const failureOf = (steps: readonly ClientToolStep[], completion: Completion): ClientToolRefused => {
  const error = completion.error ?? 'The client tool failed without saying why.'
  if (steps.length === 1) return new ClientToolRefused({ reason: 'failed', recovery: error })
  const index = completion.failedStep ?? completion.results.length
  const done = completion.results.map((result, at) => `${steps[at]?.tool ?? '?'} → ${JSON.stringify(result)}`).join('; ')
  const quoted = done.length > MAX_DONE_CHARS ? `${done.slice(0, MAX_DONE_CHARS - 1)}…` : done
  return new ClientToolRefused({
    reason: 'failed',
    recovery: `Step ${String(index + 1)} of ${String(steps.length)} (${steps[index]?.tool ?? '?'}) failed: ${error} ${
      quoted === '' ? 'No step ran before it.' : `Already done in the window: ${quoted}.`
    } The later steps did not run.`,
  })
}

/**
 * Run one client tool, or a chain of them, in a window and wait for the answer, under one `client-tool invoke` span
 * whose context the window continues.
 * @param input - one tool and its input, or steps; an optional window and timeout.
 * @param deps - the caller, the live settings and how to publish the invoke event.
 * @returns the window that ran it with the result, or each step's result for a chain.
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
  const steps = stepsOf(input)
  const names = steps.map(step => step.tool)
  yield* Effect.annotateCurrentSpan({
    'dshx.client_tool.name': names.join(','),
    'dshx.client_tool.steps': steps.length,
    'dshx.client_tool.caller': caller.kind,
  })
  if (caller.kind === 'client')
    return yield* new ClientToolRefused({
      reason: 'not-agent',
      recovery: 'client_tool_call is for Agents and Host plugins; the page runs its own tools directly.',
    })
  if (steps.length === 0 || steps.length > BridgeLimits.maxSteps)
    return yield* new ClientToolRefused({
      reason: 'unknown-tool',
      recovery: `Pass tool (one call) or steps (1 to ${String(BridgeLimits.maxSteps)} calls).`,
    })
  if (!settings.enabled)
    return yield* new ClientToolRefused({
      reason: 'disabled',
      recovery:
        'Client tools are switched off. Ask the user to turn on Settings › Client bridge › enabled (namespace dshfiles-client-bridge) if they want you to act in their window.',
    })
  const bridge = yield* ClientBridge
  const sessionId = callerSession(caller)
  const picked = BridgeWindows.pick({ windows: yield* bridge.windows, sessionId, tools: names, clientId: input.clientId })
  if (picked.kind === 'no-window') return yield* new ClientToolRefused({ reason: 'no-window', recovery: `No DSH browser window is open. ${OPEN_DSH}` })
  if (picked.kind === 'unknown-window')
    return yield* new ClientToolRefused({
      reason: 'unknown-window',
      recovery: `Window ${picked.clientId} is not open any more. Call client_tools_list for the open windows, or omit clientId.`,
    })
  if (picked.kind === 'unknown-tool')
    return yield* new ClientToolRefused({
      reason: 'unknown-tool',
      recovery: `No open window offers ${picked.missing.join(', ')}. It offers: ${picked.window.tools.map(tool => tool.name).join(', ') || 'nothing'}. Call client_tools_list for the exact names; a tool appears once the plugin that owns it is loaded.`,
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
      steps: steps.map(step => ({ tool: step.tool, input: step.input ?? {} })),
      timeoutMs,
      notify: settings.notify,
      traceparent: parent,
    })
    .pipe(
      Effect.onError(() => started.cancel),
      Effect.mapError(() => new ClientToolRefused({ reason: 'failed', recovery: `The Host could not reach the browser windows. ${OPEN_DSH}` })),
    )
  const completion = yield* started.result.pipe(Effect.tapError(error => Effect.annotateCurrentSpan({ 'dshx.client_tool.outcome': error.reason })))
  yield* Effect.annotateCurrentSpan({ 'dshx.client_tool.outcome': completion.outcome, 'dshx.client_tool.steps_done': completion.results.length })
  if (completion.outcome === 'error') return yield* failureOf(steps, completion)
  const output: ClientToolCallOutput =
    input.steps === undefined
      ? { clientId: window.clientId, tool: steps[0]?.tool ?? '', result: completion.results[0] ?? null }
      : { clientId: window.clientId, steps: steps.map((step, at) => ({ tool: step.tool, result: completion.results[at] ?? null })) }
  return output
})
