import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolExecutionResult, ToolExecutionToken, ToolRunContext, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { Exit, JsonSchema, Schema, SchemaRepresentation } from 'effect'

export const TOOL_CALL_NAME = 'tool_call'

const toolCallInput = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  args: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
})
const decodeToolCallInput = Schema.decodeUnknownExit(toolCallInput, { onExcessProperty: 'error' })

type ArgumentsDecoder = (args: unknown) => string | undefined

/**
 * One Effect decoder per definition, imported from its published JSON Schema. A schema Effect cannot import (a keyword
 * outside its Draft 2020-12 subset) is left to the target tool, which validates its own arguments in the registry.
 */
const decoders = new WeakMap<ToolDefinition, ArgumentsDecoder | null>()

const decoderFor = (definition: ToolDefinition): ArgumentsDecoder | null => {
  const cached = decoders.get(definition)
  if (cached !== undefined) return cached
  let decoder: ArgumentsDecoder | null = null
  try {
    const schema = SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12(definition.parameters), { patterns: 'apply' })
    const decode = Schema.decodeUnknownExit(Schema.make<Schema.Codec<unknown>>(schema.ast), { onExcessProperty: 'error' })
    decoder = args => {
      const exit = decode(args)
      return Exit.isSuccess(exit) ? undefined : String(exit.cause)
    }
  } catch {
    decoder = null
  }
  decoders.set(definition, decoder)
  return decoder
}

const parametersSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Exact name of a tool that tool_search returned.' },
    args: { type: 'object', description: "Arguments matching that tool's parameter schema." },
  },
  required: ['name'],
  additionalProperties: false,
}

const description =
  'Call a tool that tool_search returned, by its exact name, with arguments matching its parameter schema. The tool runs with its own permissions, approvals and rules: a tool whose description says to run only when the user asked still needs that request.'

const decodedTarget = (args: unknown) => {
  const exit = decodeToolCallInput(args)
  return Exit.isSuccess(exit) ? exit.value : undefined
}

/**
 * `tool_call { name, args }`: dispatch one tool the request does not declare through the registry's full pipeline
 * (pre-execute policies, guards, approval, post-execute), as a nested call of this one. The tool list never changes,
 * so the provider's cached prompt prefix survives every discovery.
 */
export const toolCallDefinition = (input: {
  readonly agent: Agent
  readonly tools: Pick<ToolRuntime, 'get' | 'execute'>
  /** Names the proxy never dispatches: itself and tool_search. */
  readonly reserved: ReadonlySet<string>
}): ToolDefinition => {
  const nestedContent = new Map<ToolExecutionToken, readonly ContentBlock[]>()
  const target = (name: string) => (input.reserved.has(name) ? undefined : input.tools.get(name, input.agent))
  const failure = (message: string) => new Error(message)

  return {
    name: TOOL_CALL_NAME,
    description,
    parameters: parametersSchema,
    output: {
      schema: {
        type: 'object',
        properties: { name: { type: 'string' }, meta: {} },
        required: ['name'],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) =>
        typeof value === 'object' && value !== null && !Array.isArray(value) && 'meta' in value ? (value.meta ?? null) : null,
    },
    execute: async (args: unknown, exec: ToolRunContext) => {
      if (exec.agent !== input.agent) throw failure('tool_call requires its owning live agent.')
      if (exec.parent !== undefined) throw failure('tool_call supports Native Tool Mode only.')
      const exit = decodeToolCallInput(args)
      if (Exit.isFailure(exit)) throw failure(`Invalid tool_call arguments: ${String(exit.cause)}`)
      const call = exit.value
      if (input.reserved.has(call.name)) throw failure(`tool_call cannot call ${call.name}; call it directly.`)
      const definition = target(call.name)
      if (definition === undefined) throw failure(`Unknown tool "${call.name}". Find it with tool_search first, then pass its exact name.`)
      const callArgs = call.args ?? {}
      const issue = decoderFor(definition)?.(callArgs)
      if (issue !== undefined) throw failure(`Invalid arguments for ${call.name}: ${issue}`)
      const result: ToolExecutionResult = await input.tools.execute({
        callId: ToolCallId(`${exec.callId}:${call.name}`),
        rootCallId: exec.rootCallId,
        name: call.name,
        arguments: callArgs,
        agent: input.agent,
        parent: exec.token,
        signal: exec.signal,
      })
      for (const context of result.additionalContexts ?? []) exec.deferContext(context)
      if (result.isError) throw failure(result.error.message)
      if (result.concludesTurn === true) exec.concludeTurn()
      nestedContent.set(exec.token, result.content)
      return { name: call.name, meta: result.meta ?? null }
    },
    projectContent: exec => {
      const content = nestedContent.get(exec.token)
      nestedContent.delete(exec.token)
      return content === undefined ? undefined : [...content]
    },
    presentCall: args => {
      const call = decodedTarget(args)
      return call === undefined ? undefined : target(call.name)?.presentCall?.(call.args ?? {})
    },
    presentResult: (args, result) => {
      const call = decodedTarget(args)
      return call === undefined ? undefined : target(call.name)?.presentResult?.(call.args ?? {}, result)
    },
    isConcurrencySafe: args => {
      const call = decodedTarget(args)
      return call !== undefined && target(call.name)?.isConcurrencySafe?.(call.args ?? {}) === true
    },
  }
}
