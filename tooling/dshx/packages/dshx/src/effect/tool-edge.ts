import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { Effect, Schema } from 'effect'
import { publishedJsonSchema, toToolSchema } from '../api/json-schema.js'
import { resolveApiSchema } from '../api/schema.js'
import type { PluginRuntime } from './plugin-runtime.js'
import type { EffectTool, InputSchema, ToolCall } from './tool.js'
import { causeReport } from './cause-report.js'
import { wireFailure } from './wire-error.js'

class ToolInputInvalid extends Schema.TaggedError<ToolInputInvalid>()(
  'ToolInputInvalid',
  { tool: Schema.String, issue: Schema.String },
  { dshxWireCode: 'invalid-tool-input' },
) {
  override get message(): string {
    return `Invalid arguments for ${this.tool}: ${this.issue}`
  }
}

class ToolOutputInvalid extends Schema.TaggedError<ToolOutputInvalid>()('ToolOutputInvalid', {
  tool: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.tool} returned an output its schema rejects.`
  }
}

const acceptsNoInput = (schema: InputSchema): boolean => {
  const result = resolveApiSchema(schema)['~standard'].validate(undefined)
  return !(result instanceof Promise) && result.issues === undefined
}

/** The modelled body of one call: strict decode, the tool's own Effect, then its output encoded to JSON. */
const callProgram = <Input extends InputSchema, Output, R>(tool: EffectTool<Input, Output, R>, args: unknown, call: ToolCall) =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(tool.input, { onExcessProperty: 'error' })(args).pipe(
      Effect.mapError(error => new ToolInputInvalid({ tool: tool.name, issue: error.message })),
    )
    const output = yield* tool.execute(input, call)
    if (tool.output === undefined) return output
    return yield* Schema.encodeUnknownEffect(Schema.toCodecJson(tool.output))(output).pipe(
      Effect.mapError(cause => new ToolOutputInvalid({ tool: tool.name, cause })),
    )
  })

/** A Host error (a DSH `HarnessError` carries a string `code`) keeps its identity, so the Host reports `{ name, code }`. */
const isCodedHostError = (value: unknown): value is Error & { readonly code: string } =>
  value instanceof Error && 'code' in value && typeof value.code === 'string'

/**
 * What a failed call throws to the Host: an exposed failure's message, or the coded Host error it wraps as `cause`;
 * an abort or any other failure never shows its internals to the agent.
 */
const failureThrown = (input: {
  readonly tool: string
  readonly cause: Parameters<typeof wireFailure>[0]
  readonly log: PluginRuntime<never>['log']
}): Error => {
  const failure = wireFailure(input.cause)
  if (failure.kind === 'aborted') return new Error(`${input.tool} was cancelled.`)
  if (failure.kind === 'exposed') {
    const wrapped = failure.error.cause instanceof Error ? failure.error.cause.cause : undefined
    return isCodedHostError(wrapped) ? wrapped : new Error(failure.error.message)
  }
  input.log({ topic: 'tool', level: 'error', message: `Tool ${input.tool} failed:\n${causeReport(input.cause)}` })
  return new Error(`${input.tool} failed. See Host diagnostics.`)
}

/** The native definition of an Effect tool whose calls run through `runtimeFor`. */
export const toDefinition = <Input extends InputSchema, Output, R>(
  tool: EffectTool<Input, Output, R>,
  runtimeFor: (signal: AbortSignal) => Promise<PluginRuntime<R>>,
): ToolDefinition => {
  const parameters = toToolSchema(publishedJsonSchema(tool.input, 'input'))
  const takesInput = parameters.type === 'object'
  if (!takesInput && !acceptsNoInput(tool.input)) throw new TypeError(`Tool ${tool.name} needs an object input schema, or Schema.Void for no arguments.`)
  // SAFETY: without an output schema the tool returned this JSON value itself, so it is its Output.
  const decodeOutput = (value: unknown): Output =>
    tool.output === undefined ? (value as Output) : Schema.decodeUnknownSync(Schema.toCodecJson(tool.output))(value)
  const renderContent = (value: unknown): ContentBlock[] => {
    if (tool.render === undefined) return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    const rendered = tool.render(decodeOutput(value))
    return typeof rendered === 'string' ? [{ type: 'text', text: rendered }] : [...rendered]
  }
  const presentation = tool.presentation
  const definition: ToolDefinition = {
    name: tool.name,
    description: tool.description,
    parameters: takesInput ? { ...parameters } : { type: 'object', properties: {} },
    output: {
      schema: { description: `${tool.name} output` },
      render: (_args, value) => renderContent(value),
      ...(presentation !== undefined && { presentationMeta: (_args, value) => presentation(decodeOutput(value)) }),
    },
    execute: async (args, execution) => {
      const runtime = await runtimeFor(execution.signal)
      const call: ToolCall = { callId: execution.callId, agent: execution.agent, sessionId: execution.agent?.id, nested: execution.parent !== undefined }
      const exit = await runtime.run(callProgram(tool, takesInput ? args : undefined, call), { signal: execution.signal })
      if (exit._tag === 'Success') return exit.value ?? null
      throw failureThrown({ tool: tool.name, cause: exit.cause, log: runtime.log })
    },
  }
  if (tool.timeoutMs !== undefined) definition.timeoutMs = tool.timeoutMs
  if (tool.readOnly) definition.isConcurrencySafe = () => true
  return definition
}
