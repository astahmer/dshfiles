import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { sessionSearchApi } from '@dshfiles/session-search/search-api'
import { Context, Effect, Layer } from 'effect'
import type { PromptHistory } from './library-api.js'
import { promptStashSettings, type PromptStashSettings } from './settings.js'

const DEFAULT_LIMIT = 30

/**
 * Searches the prompts sent across threads. The rows come from session-search's derived index, which already holds
 * every user message; this plugin adds the user's bounds (retention and size) and never stores a second copy.
 */
export class PromptHistoryService extends Context.Service<
  PromptHistoryService,
  { readonly search: (input: { readonly text?: string | undefined; readonly limit?: number | undefined }) => Effect.Effect<PromptHistory> }
>()('@dshfiles/prompt-stash/PromptHistoryService') {
  static readonly layer = Layer.effect(
    PromptHistoryService,
    Effect.gen(function* () {
      const settings = yield* Settings.Tag<PromptStashSettings>(promptStashSettings.namespace)
      const index = (yield* HostApis).client(sessionSearchApi)
      const search = Effect.fn('prompt history search')(function* (input: { readonly text?: string | undefined; readonly limit?: number | undefined }) {
        const current = yield* settings.get
        if (!current.promptHistory) return { status: 'disabled' as const, prompts: [] }
        const found = yield* index
          .promptHistory({
            ...(input.text === undefined ? {} : { text: input.text }),
            limit: input.limit ?? DEFAULT_LIMIT,
            window: current.historyRetention,
            maxChars: current.historyMaxChars,
          })
          .pipe(
            Effect.map(result =>
              result.ownsService ? { status: 'ready' as const, prompts: result.prompts } : { status: 'unavailable' as const, prompts: [] },
            ),
            Effect.catch(error =>
              Effect.as(Effect.logWarning('prompt-stash: prompt history read failed', error), { status: 'unavailable' as const, prompts: [] }),
            ),
          )
        yield* Effect.annotateCurrentSpan({ 'dshx.prompt_history.status': found.status, 'dshx.prompt_history.rows': found.prompts.length })
        return found
      })
      return PromptHistoryService.of({ search })
    }),
  )
}
