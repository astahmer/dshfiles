import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain, type StorageDomainWriteFailed } from '@dshfiles/dshx/effect/storage-domain'
import { Clock, Context, Effect, Layer, Ref } from 'effect'
import { legacySavedDraftSchema } from './legacy-saved-draft.js'
import { MAX_PROMPTS, PromptLibrary, promptSchema, type SavedPrompt } from './library.js'

/** The legacy drafts table stays declared so existing stored rows survive the domain reopening without being exposed again. */
export const promptStashDomain = defineDomain({
  name: 'prompt_stash',
  version: 1,
  tables: {
    prompts: { valueSchema: zodSchemaFromEffect(promptSchema), __key: 'prompts' },
    drafts: { valueSchema: zodSchemaFromEffect(legacySavedDraftSchema), __key: 'drafts' },
  },
})

export interface PromptStashMutation {
  readonly kind: 'applied' | 'conflict' | 'limit'
  readonly revision: number
  readonly prompts: SavedPrompt[]
}

export interface PromptStashSnapshot {
  readonly revision: number
  readonly prompts: SavedPrompt[]
}

interface StashState {
  readonly revision: number
  readonly records: ReadonlyMap<string, SavedPrompt>
}

const byIdAscending = (left: { readonly id: string }, right: { readonly id: string }): number => left.id.localeCompare(right.id)

/** Newest edit first, so a saved or edited prompt sits where the composer list already shows it. */
const orderPrompts = (prompts: Iterable<SavedPrompt>): SavedPrompt[] =>
  [...prompts].sort((left, right) => right.updatedAt - left.updatedAt || byIdAscending(left, right))

const snapshotOf = (state: StashState): PromptStashSnapshot => ({ revision: state.revision, prompts: orderPrompts(state.records.values()) })

/** The Host's durable prompt library, shared by every browser and plugin. */
export class PromptStash extends Context.Service<
  PromptStash,
  {
    readonly snapshot: Effect.Effect<PromptStashSnapshot>
    readonly save: (input: { readonly prompt: SavedPrompt; readonly expectedRevision: string | null }) => Effect.Effect<PromptStashMutation>
    readonly remove: (input: { readonly id: string; readonly expectedRevision: string }) => Effect.Effect<PromptStashMutation>
  }
>()('@dshfiles/prompt-stash/PromptStash') {
  static readonly orderPrompts = orderPrompts

  static readonly layer = Layer.effect(
    PromptStash,
    Effect.gen(function* () {
      const storage = yield* StorageDomain
      const domain = yield* storage.open(promptStashDomain)
      const prompts = domain.table('prompts')
      const stored = yield* prompts.entries
      const startedAt = yield* Clock.currentTimeMillis
      const state = yield* Ref.make<StashState>({
        revision: Math.max(startedAt, ...stored.map(([, prompt]) => prompt.updatedAt)),
        records: new Map(stored),
      })

      /** The revision is monotone across Host restarts: a new snapshot always outranks every revision a reader saw. */
      const commit = Effect.fnUntraced(function* (records: ReadonlyMap<string, SavedPrompt>, write: Effect.Effect<unknown, StorageDomainWriteFailed>) {
        const now = yield* Clock.currentTimeMillis
        const next = yield* Ref.updateAndGet(state, current => ({ revision: Math.max(current.revision + 1, now), records }))
        yield* write.pipe(Effect.catchTag('StorageDomainWriteFailed', error => Effect.logError('Prompt stash write failed', error)))
        return { kind: 'applied' as const, ...snapshotOf(next) }
      })

      const save = Effect.fn('prompt-stash save')(function* (input: { readonly prompt: SavedPrompt; readonly expectedRevision: string | null }) {
        const current = yield* Ref.get(state)
        const listed = orderPrompts(current.records.values())
        if (PromptLibrary.writeIfCurrent(listed, input.prompt, input.expectedRevision).kind === 'conflict') {
          return { kind: 'conflict' as const, revision: current.revision, prompts: listed }
        }
        if (!current.records.has(input.prompt.id) && current.records.size >= MAX_PROMPTS) {
          return { kind: 'limit' as const, revision: current.revision, prompts: listed }
        }
        return yield* commit(new Map(current.records).set(input.prompt.id, input.prompt), prompts.put(input.prompt.id, input.prompt))
      }, domain.withWriteLock)

      const remove = Effect.fn('prompt-stash remove')(function* (input: { readonly id: string; readonly expectedRevision: string }) {
        const current = yield* Ref.get(state)
        const listed = orderPrompts(current.records.values())
        if (PromptLibrary.removeIfCurrent(listed, input.id, input.expectedRevision).kind === 'conflict') {
          return { kind: 'conflict' as const, revision: current.revision, prompts: listed }
        }
        const records = new Map(current.records)
        records.delete(input.id)
        return yield* commit(records, prompts.delete(input.id))
      }, domain.withWriteLock)

      return PromptStash.of({ snapshot: Effect.map(Ref.get(state), snapshotOf), save, remove })
    }),
  )
}
