import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolOutputDefinition, ToolRunContext, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { Effect, type Schema, type Scope } from 'effect'
import { detachedContext } from './detached.js'
import { HostContext, type HostServiceMissing, hostService } from './host-context.js'
import { runtimeOf } from './plugin-runtime.js'
import { toDefinition } from './tool-edge.js'

/** The agent call one tool execution serves. Its AbortSignal is not here: an abort interrupts the fiber. */
export interface ToolCall {
  readonly callId: string
  readonly agent: ToolRunContext['agent']
  readonly sessionId: string | undefined
}

/** The input schema of an Effect tool: decoding needs no services. */
export type InputSchema = Schema.Codec<unknown, unknown>

/** An agent tool whose input is an Effect Schema and whose body is an Effect. */
export interface EffectTool<Input extends InputSchema, Output, out R> {
  readonly name: string
  readonly description: string
  readonly input: Input
  readonly output: Schema.Codec<Output, unknown> | undefined
  readonly readOnly: boolean
  readonly timeoutMs: number | undefined
  render?(output: Output): ToolRendering
  presentation?(output: Output): ToolPresentation
  execute(input: Input['Type'], call: ToolCall): Effect.Effect<Output, unknown, R>
}

/** What the model reads for a successful output: plain text, or content blocks such as an image. */
export type ToolRendering = string | ReadonlyArray<ContentBlock>

/** The replayable presentation metadata a UI renders a settled call from (`result.meta`). */
export type ToolPresentation = ReturnType<NonNullable<ToolOutputDefinition['presentationMeta']>>

/** Any Effect tool requiring `R`, whatever its schemas. */
export type AnyEffectTool<R> = EffectTool<InputSchema, unknown, R>

/** Declare an agent tool: the input schema is published to the model and decoded strictly before `execute`. */
export const make = <Input extends InputSchema, Output, R>(options: {
  readonly name: string
  readonly description: string
  readonly input: Input
  readonly output?: Schema.Codec<Output, unknown>
  /** A read-only tool may run beside sibling tool calls. */
  readonly readOnly?: boolean
  /** Model-facing content for a successful output; defaults to pretty-printed JSON. */
  readonly render?: (output: Output) => ToolRendering
  /** Presentation metadata a UI renders the settled call from; never sent to the model. */
  readonly presentation?: (output: Output) => ToolPresentation
  /** Cooperative deadline the Host's tool-call timeout policy enforces by aborting the call. */
  readonly timeoutMs?: number
  readonly execute: (input: Input['Type'], call: ToolCall) => Effect.Effect<Output, unknown, R>
}): EffectTool<Input, Output, R> => ({
  name: options.name,
  description: options.description,
  input: options.input,
  output: options.output,
  readOnly: options.readOnly === true,
  timeoutMs: options.timeoutMs,
  ...(options.render !== undefined && { render: options.render }),
  ...(options.presentation !== undefined && { presentation: options.presentation }),
  execute: options.execute,
})

/**
 * Register `tool` for as long as the current Scope lives, e.g. a tool that exists only while an agent session runs.
 * Pass `tools` to register into one agent's scoped runtime instead of the global one.
 */
export const register = <Input extends InputSchema, Output, R>(
  tool: EffectTool<Input, Output, R>,
  options: { readonly tools?: Pick<ToolRuntime, 'register'> } = {},
): Effect.Effect<void, HostServiceMissing, Scope.Scope | HostContext | R> =>
  Effect.gen(function* () {
    const host = yield* HostContext
    const tools = options.tools ?? (yield* hostService('tools'))
    const services = yield* detachedContext<R>()
    const runtime = runtimeOf({ services, ctx: host.ctx })
    const definition = toDefinition(tool, () => Promise.resolve(runtime))
    yield* Effect.acquireRelease(
      Effect.sync(() => tools.register(definition)),
      unregister => Effect.sync(unregister),
    )
  })
