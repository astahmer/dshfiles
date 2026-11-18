import { runClientTool, type ClientToolItem, type ClientToolResult } from '@dshfiles/dshx/client'
import { parseTraceparent, startSpan, withSpan, type BrowserStartSpanOptions } from '@dshfiles/dshx/tracing/client'
import type { clientBridgeApi, completionSchema } from './api.js'
import type { ApiEventClientPayload } from '@dshfiles/dshx/api'
import type { Json } from 'effect/Schema'

export type InvokeRequest = ApiEventClientPayload<NonNullable<typeof clientBridgeApi.events>['invoke']>
export type Completion = typeof completionSchema.Type

const MAX_ERROR_CHARS = 2_000

const describeError = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS - 1)}…` : text
}

/** A result the Host can carry: JSON, or null for `undefined`. */
const toJson = (value: ClientToolResult): Json => {
  if (value === undefined) return null
  // SAFETY: JSON.parse of JSON.stringify output is a JSON value; a value JSON cannot hold throws in stringify.
  return JSON.parse(JSON.stringify(value) ?? 'null') as Json
}

/**
 * Run one invoke request addressed to this window and build its reply. Every tool runs under one browser span that
 * continues the Host's `client-tool invoke` trace, and the reply is sent from inside it so the Host's
 * `client-bridge/complete` dispatch joins the same trace.
 * @param input - the request, this window's id and tools, the notice to show for writes, and the reply sender.
 * @returns the reply sent, or undefined when the request was for another window.
 */
const run = async (input: {
  readonly request: InvokeRequest
  readonly clientId: string
  readonly tools: readonly ClientToolItem[]
  readonly notice: (tool: ClientToolItem) => void
  readonly reply: (completion: Completion) => void
}): Promise<Completion | undefined> => {
  const { request } = input
  if (request.clientId !== input.clientId) return undefined
  const parent = parseTraceparent(request.traceparent)
  const options: BrowserStartSpanOptions = {
    kind: 'internal',
    attributes: { 'dshx.client_tool.name': request.tool },
    ...(parent !== undefined && { parent }),
  }
  const span = startSpan('client-tool execute', options)
  const base = { requestId: request.requestId, clientId: input.clientId }
  let completion: Completion
  const tool = input.tools.find(candidate => candidate.name === request.tool)
  if (tool === undefined) {
    completion = { ...base, outcome: 'error', error: `This window no longer offers ${request.tool}. Call client_tools_list again.` }
  } else {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`The call timed out after ${String(request.timeoutMs)} ms.`)), request.timeoutMs)
    try {
      const result = await runClientTool(tool, request.input, { signal: controller.signal })
      completion = { ...base, outcome: 'ok', result: toJson(result) }
      if (request.notify && !tool.readOnly) input.notice(tool)
    } catch (error) {
      span.recordFailure(error)
      completion = { ...base, outcome: 'error', error: describeError(error) }
    } finally {
      clearTimeout(timer)
    }
  }
  span.setAttribute('dshx.client_tool.outcome', completion.outcome)
  await withSpan('client-tool reply', { kind: 'internal', ...(span.context !== undefined && { parent: span.context }) }, () => input.reply(completion))
  span.end()
  return completion
}

export class InvokeRunner {
  static readonly run = run
}
