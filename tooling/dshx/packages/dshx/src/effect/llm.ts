import { BlockAssembler, createUserMessage, ReasoningEffortId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { Context, Effect, Layer, Schema, Stream } from 'effect'
import { hostService } from './host-context.js'

/** The model call failed: the adapter reported an error finish, or the stream itself threw. */
export class LlmCallFailed extends Schema.TaggedError<LlmCallFailed>()('LlmCallFailed', {
  provider: Schema.String,
  model: Schema.String,
  reason: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The ${this.provider}/${this.model} model call failed${this.reason === undefined ? '' : `: ${this.reason}`}. Check the account in AI Accounts, then retry.`
  }
}

export interface LlmCompletion {
  readonly provider: string
  readonly model: string
  readonly system: string
  readonly input: string
  readonly reasoningEffort?: string | undefined
  readonly maxTokens?: number | undefined
  readonly purpose?: GenerateOptions['purpose']
}

/** One-shot model calls through DSH's model runtime, with the user's configured accounts and routing. */
export class Llm extends Context.Service<
  Llm,
  {
    /** Raw chunks of one model call; interrupting the stream aborts the request. */
    readonly stream: (options: Omit<GenerateOptions, 'signal'>) => Stream.Stream<StreamChunk, LlmCallFailed>
    /** The text of a single-turn answer to `input`. */
    readonly complete: (request: LlmCompletion) => Effect.Effect<string, LlmCallFailed>
  }
>()('@dshfiles/dshx/Llm') {
  static readonly layer = Layer.effect(
    Llm,
    Effect.gen(function* () {
      const llm = yield* hostService('llm')
      const stream = (options: Omit<GenerateOptions, 'signal'>) =>
        Stream.unwrap(
          Effect.map(Effect.abortSignal, signal =>
            Stream.fromAsyncIterable(
              llm.stream({ ...options, signal }),
              cause => new LlmCallFailed({ provider: options.provider, model: options.model, cause }),
            ),
          ),
        )
      const complete = Effect.fn('llm complete')(function* (request: LlmCompletion) {
        yield* Effect.annotateCurrentSpan({ 'gen_ai.provider.name': request.provider, 'gen_ai.request.model': request.model })
        const assembler = new BlockAssembler()
        yield* Stream.runForEach(
          stream({
            provider: request.provider,
            model: request.model,
            system: request.system,
            messages: [createUserMessage({ content: [{ type: 'text', text: request.input }], source: { kind: 'user' } })],
            maxTokens: request.maxTokens ?? 512,
            ...(request.purpose !== undefined && { purpose: request.purpose }),
            ...(request.reasoningEffort !== undefined && { reasoningEffort: ReasoningEffortId(request.reasoningEffort) }),
          }),
          chunk => Effect.sync(() => assembler.push(chunk)),
        )
        if (assembler.finish.kind === 'error')
          return yield* new LlmCallFailed({ provider: request.provider, model: request.model, reason: assembler.finish.failure.message })
        return assembler
          .blocks()
          .flatMap(block => (block.type === 'text' ? [block.text] : []))
          .join('')
      })
      return Llm.of({ stream, complete })
    }),
  )
}
