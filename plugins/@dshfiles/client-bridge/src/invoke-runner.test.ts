import { defineClientTool, type ClientToolItem } from '@dshfiles/dshx/client'
import { recordBrowserSpans } from '@dshfiles/dshx/tracing/client'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { InvokeRunner, type Completion, type InvokeRequest } from './invoke-runner.js'

const HOST_TRACE = '0af7651916cd43dd8448eb211c80319c'
const HOST_SPAN = 'b7ad6b7169203331'

const openSettings = (log: unknown[]): ClientToolItem =>
  defineClientTool({
    name: 'settings_open',
    title: 'Open Settings',
    description: 'Open Settings. Call only when the user asked.',
    readOnly: false,
    input: Schema.Struct({ section: Schema.String }),
    execute: input => {
      log.push(input)
      return { opened: input.section }
    },
  })

const listTabs: ClientToolItem = defineClientTool({
  name: 'tabs_list',
  title: 'List tabs',
  description: 'List tabs.',
  readOnly: true,
  input: Schema.Struct({}),
  execute: () => [],
})

const request = (overrides: Partial<InvokeRequest> = {}): InvokeRequest => ({
  requestId: 'r1',
  clientId: 'me',
  tool: 'settings_open',
  input: { section: 'market' },
  timeoutMs: 5_000,
  notify: true,
  traceparent: `00-${HOST_TRACE}-${HOST_SPAN}-01`,
  ...overrides,
})

const runner = (input: { readonly request: InvokeRequest; readonly tools: readonly ClientToolItem[] }) => {
  const replies: Completion[] = []
  const notices: string[] = []
  const done = InvokeRunner.run({
    ...input,
    clientId: 'me',
    notice: tool => notices.push(tool.title),
    reply: completion => replies.push(completion),
  })
  return { done, replies, notices }
}

describe('client-bridge invoke runner', () => {
  it('runs the tool, replies with its result, tells the user, and continues the Host trace', async () => {
    using spans = recordBrowserSpans()
    const log: unknown[] = []
    const { done, replies, notices } = runner({ request: request(), tools: [openSettings(log)] })
    await done
    expect(log).toEqual([{ section: 'market' }])
    expect(replies).toEqual([{ requestId: 'r1', clientId: 'me', outcome: 'ok', result: { opened: 'market' } }])
    expect(notices).toEqual(['Open Settings'])
    const span = spans.span('client-tool execute')
    expect(span).toMatchObject({ traceId: HOST_TRACE, parentSpanId: HOST_SPAN })
    expect(spans.children(span).map(child => child.name)).toEqual(['client-tool reply'])
  })

  it('ignores a request for another window', async () => {
    const { done, replies } = runner({ request: request({ clientId: 'someone-else' }), tools: [openSettings([])] })
    expect(await done).toBeUndefined()
    expect(replies).toEqual([])
  })

  it('replies with the validation error instead of running a bad input', async () => {
    const log: unknown[] = []
    const { done, replies, notices } = runner({ request: request({ input: { section: 3 } }), tools: [openSettings(log)] })
    await done
    expect(log).toEqual([])
    expect(notices).toEqual([])
    expect(replies[0]).toMatchObject({ outcome: 'error', error: expect.stringMatching(/validation failed/u) })
  })

  it('says when the tool is gone and never notifies for a read', async () => {
    const missing = runner({ request: request({ tool: 'tabs_open' }), tools: [] })
    await missing.done
    expect(missing.replies[0]).toMatchObject({ outcome: 'error', error: expect.stringMatching(/no longer offers tabs_open/u) })
    const read = runner({ request: request({ tool: 'tabs_list', input: {} }), tools: [listTabs] })
    await read.done
    expect(read.replies[0]).toMatchObject({ outcome: 'ok', result: [] })
    expect(read.notices).toEqual([])
  })
})
