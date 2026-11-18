import { runClientTool, type ClientToolItem, type ClientToolResult } from '@dshfiles/dshx/client'
import { parseTraceparent, startSpan, withSpan, type BrowserSpan } from '@dshfiles/dshx/tracing/client'
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

/** The outcome of running the steps in order: their results, and the failure that stopped them, if any. */
interface ChainOutcome {
  readonly results: readonly Json[]
  readonly ran: readonly ClientToolItem[]
  readonly failure?: { readonly step: number; readonly error: string }
}

/** Run each step in order under its own `client-tool step` span, stopping at the first failure. */
const runSteps = async (input: {
  readonly request: InvokeRequest
  readonly tools: readonly ClientToolItem[]
  readonly parent: BrowserSpan
  readonly signal: AbortSignal
}): Promise<ChainOutcome> => {
  const results: Json[] = []
  const ran: ClientToolItem[] = []
  for (const [index, step] of input.request.steps.entries()) {
    const tool = input.tools.find(candidate => candidate.name === step.tool)
    if (tool === undefined) return { results, ran, failure: { step: index, error: `This window no longer offers ${step.tool}. Call client_tools_list again.` } }
    const span = startSpan('client-tool step', {
      kind: 'internal',
      attributes: { 'dshx.client_tool.name': step.tool, 'dshx.client_tool.step': index },
      ...(input.parent.context !== undefined && { parent: input.parent.context }),
    })
    try {
      results.push(toJson(await runClientTool(tool, step.input, { signal: input.signal })))
      ran.push(tool)
    } catch (error) {
      span.recordFailure(error)
      return { results, ran, failure: { step: index, error: describeError(error) } }
    } finally {
      span.end()
    }
  }
  return { results, ran }
}

/**
 * Run one invoke request addressed to this window and build its reply. The steps run under one browser span that
 * continues the Host's `client-tool invoke` trace, one child span each, and the reply is sent from inside it so the
 * Host's `client-bridge/complete` dispatch joins the same trace. One notice names every page-changing step that ran.
 * @param input - the request, this window's id and tools, the notice to show for writes, and the reply sender.
 * @returns the reply sent, or undefined when the request was for another window.
 */
const run = async (input: {
  readonly request: InvokeRequest
  readonly clientId: string
  readonly tools: readonly ClientToolItem[]
  readonly notice: (tools: readonly ClientToolItem[]) => void
  readonly reply: (completion: Completion) => void
}): Promise<Completion | undefined> => {
  const { request } = input
  if (request.clientId !== input.clientId) return undefined
  const parent = parseTraceparent(request.traceparent)
  const span = startSpan('client-tool execute', {
    kind: 'internal',
    attributes: { 'dshx.client_tool.name': request.steps.map(step => step.tool).join(','), 'dshx.client_tool.steps': request.steps.length },
    ...(parent !== undefined && { parent }),
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`The call timed out after ${String(request.timeoutMs)} ms.`)), request.timeoutMs)
  const outcome = await runSteps({ request, tools: input.tools, parent: span, signal: controller.signal }).finally(() => clearTimeout(timer))
  const writes = outcome.ran.filter(tool => !tool.readOnly)
  if (request.notify && writes.length > 0) input.notice(writes)
  const base = { requestId: request.requestId, clientId: input.clientId, results: outcome.results }
  const completion: Completion =
    outcome.failure === undefined ? { ...base, outcome: 'ok' } : { ...base, outcome: 'error', failedStep: outcome.failure.step, error: outcome.failure.error }
  span.setAttributes({ 'dshx.client_tool.outcome': completion.outcome, 'dshx.client_tool.steps_done': outcome.results.length })
  await withSpan('client-tool reply', { kind: 'internal', ...(span.context !== undefined && { parent: span.context }) }, () => input.reply(completion))
  span.end()
  return completion
}

export class InvokeRunner {
  static readonly run = run
}
