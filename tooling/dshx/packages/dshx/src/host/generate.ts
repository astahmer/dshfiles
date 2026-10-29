import type { Context } from '@deepseek-ai/cordis'
import type { BlockAssembler, GenerateOptions, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { PluginApiError } from '../api/common.js'
import { publishedJsonSchema } from '../api/json-schema.js'

export interface GenerateModel {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface GenerateInput<Output = string> {
  /** The user turn; ignored when `messages` is given. */
  readonly prompt?: string
  readonly messages?: GenerateOptions['messages']
  readonly system?: string
  /** Defaults to the Host's default model selection. */
  readonly model?: GenerateModel
  /**
   * Ask for one JSON value this schema accepts (a zod schema publishes its JSON Schema to the model); the result's
   * `value` is the decoded output. One invalid reply is answered with the validation issues before it fails.
   */
  readonly schema?: StandardSchemaV1<unknown, Output>
  /** Thread the call is made for: providers that key requests per session need it. */
  readonly sessionId?: string
  readonly maxTokens?: number
  readonly signal?: AbortSignal
}

export interface GenerateResult<Output = string> {
  readonly text: string
  /** The decoded output with a `schema`, else the text. */
  readonly value: Output
  readonly provider: string
  readonly model: string
  readonly usage: TokenUsage | undefined
}

interface LlmLike {
  stream(options: GenerateOptions): AsyncIterable<Parameters<BlockAssembler['push']>[0]>
}

interface DefaultModelLike {
  currentSelection(): { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
}

const service = <T>(ctx: Context, name: string): T | undefined => {
  try {
    return ctx.get(name) as T | undefined
  } catch {
    return undefined
  }
}

const schemaInstructions = (schema: StandardSchemaV1): string => {
  const jsonSchema = publishedJsonSchema(schema, 'output')
  return [
    'Reply with exactly one JSON value and nothing else: no prose, no code fence.',
    jsonSchema === undefined ? '' : `It must match this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
  ]
    .filter(line => line !== '')
    .join('\n')
}

const stripFence = (text: string): string =>
  text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim()

const decode = async <Output>(
  schema: StandardSchemaV1<unknown, Output>,
  text: string,
): Promise<{ readonly ok: true; readonly value: Output } | { readonly ok: false; readonly issues: string }> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(text))
  } catch (cause) {
    return { ok: false, issues: `The reply is not JSON: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
  const result = await schema['~standard'].validate(parsed)
  if (result.issues === undefined) return { ok: true, value: result.value }
  return { ok: false, issues: result.issues.map(issue => `${(issue.path ?? []).map(String).join('.') || '(root)'}: ${issue.message}`).join('\n') }
}

export function generate(ctx: Context, input: GenerateInput & { readonly schema?: undefined }): Promise<GenerateResult>
export function generate<Output>(
  ctx: Context,
  input: GenerateInput<Output> & { readonly schema: StandardSchemaV1<unknown, Output> },
): Promise<GenerateResult<Output>>
/**
 * One model call outside any thread: no tools, nothing written to a Session log. Retries once without a reasoning
 * effort the model refuses, and once with the validation issues when a `schema` reply does not decode.
 */
export async function generate(ctx: Context, input: GenerateInput<unknown>): Promise<GenerateResult<unknown>> {
  const llm = service<LlmLike>(ctx, 'llm')
  if (llm === undefined)
    throw new PluginApiError('The Host has no language-model service. Add the llm row to the profile, then restart DSH.', { code: 'llm-unavailable' })
  const model = input.model ?? service<DefaultModelLike>(ctx, 'agentDefaultModel')?.currentSelection()
  if (model === undefined)
    throw new PluginApiError('No model was named and the Host has no default model. Pick one in Settings › Models.', { code: 'model-unavailable' })
  // Loaded on first call: a static import would make every dshx Host artifact import dsh-llm, used or not.
  const { BlockAssembler, ReasoningEffortId, createUserMessage } = await import('@deepseek-ai/dsh-llm')
  const system = [input.system, input.schema === undefined ? undefined : schemaInstructions(input.schema)]
    .filter(part => part !== undefined && part !== '')
    .join('\n\n')
  let messages: GenerateOptions['messages'] = input.messages ?? [
    createUserMessage({ content: [{ type: 'text', text: input.prompt ?? '' }], source: { kind: 'user' } }),
  ]
  let effort = model.reasoningEffort
  let corrected = false
  for (;;) {
    const options: GenerateOptions = {
      provider: model.provider,
      model: model.model,
      messages,
      // Marks a side call: usage recorders and the request-messages polyfill keep it out of the thread's own requests.
      purpose: 'compaction',
      ...(system === '' ? undefined : { system }),
      ...(effort === undefined ? undefined : { reasoningEffort: ReasoningEffortId(effort) }),
      ...(input.maxTokens === undefined ? undefined : { maxTokens: input.maxTokens }),
      ...(input.signal === undefined ? undefined : { signal: input.signal }),
      // SAFETY: SessionId is a type-only brand over the Session's string id.
      ...(input.sessionId === undefined ? undefined : { sessionId: input.sessionId as NonNullable<GenerateOptions['sessionId']> }),
    }
    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream(options)) assembler.push(chunk)
    const finish = assembler.finish
    if (finish.kind === 'error' && finish.failure.code === 'UNSUPPORTED_REASONING_EFFORT' && effort !== undefined) {
      effort = undefined
      continue
    }
    if (finish.kind === 'aborted') throw input.signal?.reason ?? new PluginApiError('The model call was aborted.', { code: 'generate-aborted' })
    if (finish.kind === 'error') throw new PluginApiError(`The model call failed: ${finish.failure.message}`.slice(0, 500), { code: 'generate-failed' })
    const text = assembler
      .blocks()
      .flatMap(block => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim()
    const result = { text, provider: model.provider, model: model.model, usage: assembler.usage }
    if (input.schema === undefined) return { ...result, value: text }
    const decoded = await decode(input.schema, text)
    if (decoded.ok) return { ...result, value: decoded.value }
    if (corrected)
      throw new PluginApiError(`The model reply did not match the requested shape:\n${decoded.issues}`.slice(0, 500), { code: 'generate-invalid-output' })
    corrected = true
    messages = [
      ...messages,
      createUserMessage({
        content: [{ type: 'text', text: `Your reply was:\n${text}\n\nIt is invalid:\n${decoded.issues}\n\nReply again with only the corrected JSON value.` }],
        source: { kind: 'user' },
      }),
    ]
  }
}
