export * as HostPrompt from './host-prompt.js'

import type { AssembleContext, PromptContext, PromptSection } from '@deepseek-ai/dsh-system-prompt'
import { Effect, Exit, type Scope } from 'effect'
import { causeReport } from './cause-report.js'
import { safeCordisLogger } from '../host/safe-logger.js'
import { detachedContext } from './detached.js'
import { HostContext, hostService, type HostServiceMissing } from './host-context.js'

/** Static text, or an Effect evaluated at each assembly. Assembly is synchronous, so the Effect must not suspend. */
export type PromptText<R> = string | ((assembly: AssembleContext) => Effect.Effect<string, never, R>)

/** A system-prompt section whose text may be an Effect; every other field is the native `PromptSection`'s. */
export interface Section<R> extends Omit<PromptSection, 'text'> {
  readonly text: PromptText<R>
}

/** A dynamic prompt context whose text may be an Effect; every other field is the native `PromptContext`'s. */
export interface ModelContext<R> extends Omit<PromptContext, 'text'> {
  readonly text: PromptText<R>
}

const textProvider = Effect.fnUntraced(function* <R>(input: { readonly name: string; readonly text: PromptText<R> }) {
  const text = input.text
  if (typeof text === 'string') return text
  const host = yield* HostContext
  const runSync = Effect.runSyncExitWith(yield* detachedContext<R>())
  return (assembly: AssembleContext): string => {
    const exit = runSync(text(assembly))
    if (Exit.isSuccess(exit)) return exit.value
    safeCordisLogger(host.ctx, 'dshx:prompt').error(`Prompt text ${input.name} failed:\n${causeReport(exit.cause)}`)
    return ''
  }
})

/** Contribute a system-prompt section for as long as the current Scope lives; a failing text is logged and empty. */
export const section = <R = never>(input: Section<R>): Effect.Effect<void, HostServiceMissing, Scope.Scope | HostContext | R> =>
  Effect.gen(function* () {
    const systemPrompt = yield* hostService('systemPrompt')
    const text = yield* textProvider({ name: input.name, text: input.text })
    yield* Effect.acquireRelease(
      Effect.sync(() => systemPrompt.section({ ...input, text })),
      dispose => Effect.sync(dispose),
    )
  })

/** Contribute dynamic model context for as long as the current Scope lives; a failing text is logged and empty. */
export const context = <R = never>(input: ModelContext<R>): Effect.Effect<void, HostServiceMissing, Scope.Scope | HostContext | R> =>
  Effect.gen(function* () {
    const systemPrompt = yield* hostService('systemPrompt')
    const text = yield* textProvider({ name: input.name, text: input.text })
    yield* Effect.acquireRelease(
      Effect.sync(() => systemPrompt.context({ ...input, text })),
      dispose => Effect.sync(dispose),
    )
  })
