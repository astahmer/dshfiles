import type { ApiCaller } from '@dshfiles/dshx/api'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Cause, Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import type { WindowState } from './api.js'
import { ClientBridge } from './bridge.js'
import { runClientToolCall, type InvokePayload } from './client-tool-call.js'
import { ClientToolRefused } from './errors.js'

const agent: ApiCaller = { kind: 'agent', sessionId: 's1' }
const on = { enabled: true, notify: true }

const window = (clientId: string, overrides: Partial<WindowState> = {}): WindowState => ({
  clientId,
  label: 'Chrome on macOS',
  focused: true,
  visible: true,
  sessionId: 's1',
  tools: [
    { name: 'settings_open', title: 'Open Settings', description: 'Open Settings.', readOnly: false, inputSchema: {} },
    { name: 'tabs_open', title: 'Open a tab', description: 'Open a tab.', readOnly: false, inputSchema: {} },
  ],
  ...overrides,
})

const run = <A, E>(effect: Effect.Effect<A, E, ClientBridge>) =>
  Effect.runPromise(Effect.exit(effect).pipe(Effect.provide(Layer.mergeAll(ClientBridge.layer, DshxEffect.tracerLayer))))

const refusal = (exit: Exit.Exit<unknown, unknown>): string | undefined => {
  if (!Exit.isFailure(exit)) return undefined
  const error = Cause.squash(exit.cause)
  return error instanceof ClientToolRefused ? error.reason : `unexpected: ${String(error)}`
}

/** A window that answers every invoke the way the page does: through `complete`. */
const answering = (
  answer: (payload: InvokePayload) => {
    readonly outcome: 'ok' | 'error'
    readonly results: readonly string[]
    readonly failedStep?: number
    readonly error?: string
  },
) =>
  Effect.gen(function* () {
    const bridge = yield* ClientBridge
    const sent: InvokePayload[] = []
    const publish = (payload: InvokePayload) =>
      Effect.gen(function* () {
        sent.push(payload)
        yield* Effect.forkDetach(bridge.complete({ requestId: payload.requestId, clientId: payload.clientId, ...answer(payload) }))
      })
    return { bridge, sent, publish }
  })

describe('client_tool_call', () => {
  it('sends the call to the window showing the thread and returns its result, under one client-tool invoke span', async () => {
    using spans = recordSpans()
    const exit = await run(
      Effect.gen(function* () {
        const { bridge, sent, publish } = yield* answering(() => ({ outcome: 'ok', results: ['opened'] }))
        yield* bridge.announce(window('other', { sessionId: 's2' }))
        yield* bridge.announce(window('mine'))
        const result = yield* runClientToolCall({ tool: 'settings_open', input: { section: 'market' } }, { caller: agent, settings: on, publish })
        return { result, sent }
      }),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (!Exit.isSuccess(exit)) return
    expect(exit.value.result).toEqual({ clientId: 'mine', tool: 'settings_open', result: 'opened' })
    const [payload] = exit.value.sent
    expect(payload).toMatchObject({ clientId: 'mine', steps: [{ tool: 'settings_open', input: { section: 'market' } }], notify: true })
    const span = spans.span('client-tool invoke')
    expect(span.attributes).toMatchObject({ 'dshx.client_tool.name': 'settings_open', 'dshx.client_tool.outcome': 'ok' })
    // The window continues this exact span.
    expect(payload?.traceparent).toBe(`00-${span.traceId}-${span.spanId}-01`)
  })

  it('reports the window’s error to the Agent', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const { bridge, publish } = yield* answering(() => ({ outcome: 'error', results: [], failedStep: 0, error: 'No section market.' }))
        yield* bridge.announce(window('mine'))
        return yield* runClientToolCall({ tool: 'settings_open' }, { caller: agent, settings: on, publish })
      }),
    )
    expect(refusal(exit)).toBe('failed')
  })

  it('runs a chain in one window in one round trip and returns each step’s result', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const { bridge, sent, publish } = yield* answering(payload => ({ outcome: 'ok', results: payload.steps.map(step => `${step.tool} done`) }))
        yield* bridge.announce(window('mine'))
        const result = yield* runClientToolCall(
          {
            steps: [
              { tool: 'tabs_open', input: { panelId: 'dshfiles-settings' } },
              { tool: 'settings_open', input: { section: 'market' } },
            ],
          },
          { caller: agent, settings: on, publish },
        )
        return { result, sent }
      }),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (!Exit.isSuccess(exit)) return
    expect(exit.value.sent).toHaveLength(1)
    expect(exit.value.result).toEqual({
      clientId: 'mine',
      steps: [
        { tool: 'tabs_open', result: 'tabs_open done' },
        { tool: 'settings_open', result: 'settings_open done' },
      ],
    })
  })

  it('names the failed step of a chain and what already ran before it', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const { bridge, publish } = yield* answering(() => ({ outcome: 'error', results: ['tab opened'], failedStep: 1, error: 'No section nope.' }))
        yield* bridge.announce(window('mine'))
        return yield* runClientToolCall(
          { steps: [{ tool: 'tabs_open' }, { tool: 'settings_open', input: { section: 'nope' } }] },
          { caller: agent, settings: on, publish },
        )
      }),
    )
    expect(refusal(exit)).toBe('failed')
    const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
    expect(String(error)).toMatch(
      /Step 2 of 2 \(settings_open\) failed: No section nope\. Already done in the window: tabs_open → "tab opened"\. The later steps did not run\./u,
    )
  })

  it('refuses a chain when the window lacks one of its tools, naming it', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const bridge = yield* ClientBridge
        yield* bridge.announce(window('mine'))
        return yield* runClientToolCall({ steps: [{ tool: 'tabs_open' }, { tool: 'files_open' }] }, { caller: agent, settings: on, publish: () => Effect.void })
      }),
    )
    expect(refusal(exit)).toBe('unknown-tool')
    expect(String(Exit.isFailure(exit) ? Cause.squash(exit.cause) : '')).toMatch(/No open window offers files_open\./u)
  })

  it('refuses while switched off, without a window, from a page, or for a tool no window offers', async () => {
    const publish = () => Effect.void
    const call = (settings: typeof on, caller: ApiCaller, tool = 'settings_open', announce = true) =>
      run(
        Effect.gen(function* () {
          const bridge = yield* ClientBridge
          if (announce) yield* bridge.announce(window('mine'))
          return yield* runClientToolCall({ tool }, { caller, settings, publish })
        }),
      )
    expect(refusal(await call({ enabled: false, notify: true }, agent))).toBe('disabled')
    expect(refusal(await call(on, agent, 'settings_open', false))).toBe('no-window')
    expect(refusal(await call(on, { kind: 'client' }))).toBe('not-agent')
    expect(refusal(await call(on, agent, 'files_open'))).toBe('unknown-tool')
  })

  it('gives up after the timeout when the window never answers', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const bridge = yield* ClientBridge
        yield* bridge.announce(window('mine'))
        return yield* runClientToolCall({ tool: 'settings_open', timeoutMs: 1_000 }, { caller: agent, settings: on, publish: () => Effect.void })
      }),
    )
    expect(refusal(exit)).toBe('timeout')
  })

  it('fails the pending call at once when its window leaves', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const bridge = yield* ClientBridge
        yield* bridge.announce(window('mine'))
        const publish = (payload: InvokePayload) => Effect.forkDetach(bridge.leave(payload.clientId)).pipe(Effect.asVoid)
        return yield* runClientToolCall({ tool: 'settings_open' }, { caller: agent, settings: on, publish })
      }),
    )
    expect(refusal(exit)).toBe('window-closed')
  })

  it('ignores a reply from another window', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const bridge = yield* ClientBridge
        const started = yield* bridge.start({ clientId: 'mine', timeoutMs: 1_000 })
        return yield* bridge.complete({ requestId: started.requestId, clientId: 'intruder', outcome: 'ok', results: [1] })
      }),
    )
    expect(exit).toEqual(Exit.succeed(false))
  })
})
