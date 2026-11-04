import { Cache, Context, Duration, Effect, Exit, Layer, Option, Schema } from 'effect'
import { HostAgents, SessionCorpus } from './host-edge-promise.js'

/**
 * Resolves a direct-message recipient against the mailboxes that can actually read it: a live Agent, or a Session that
 * the persistence backend still lists. A mistyped Session id otherwise stores a message nobody will ever open.
 */

export type RecipientResolution =
  | { readonly status: 'live' }
  | { readonly status: 'durable' }
  | { readonly status: 'unknown'; readonly suggestions: readonly string[] }

const asSessionId = (id: string): string => (id.startsWith('session-') ? id : `session-${id}`)

const sharedPrefixLength = (left: string, right: string): number => {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

export class RecipientDirectoryModel {
  /** A near-miss keeps the Session prefix and most of the UUID; a shared bare `session-` prefix suggests nothing. */
  private static readonly minSuggestionPrefixLength = 16
  private static readonly maxSuggestions = 3

  static readonly resolve = (input: {
    readonly requestedId: string
    readonly liveIds: readonly string[]
    readonly durableIds: readonly string[]
  }): RecipientResolution => {
    const requested = input.requestedId.trim()
    if (RecipientDirectoryModel.matches({ requested, candidateIds: input.liveIds })) return { status: 'live' }
    if (RecipientDirectoryModel.matches({ requested, candidateIds: input.durableIds })) return { status: 'durable' }
    return {
      status: 'unknown',
      suggestions: RecipientDirectoryModel.suggest({ requestedId: requested, knownIds: [...input.liveIds, ...input.durableIds] }),
    }
  }

  static readonly suggest = (input: { readonly requestedId: string; readonly knownIds: readonly string[] }): readonly string[] => {
    const requested = asSessionId(input.requestedId)
    return [...new Set(input.knownIds.map(asSessionId))]
      .filter(candidate => candidate !== requested)
      .map(candidate => ({ candidate, shared: sharedPrefixLength(requested, candidate) }))
      .filter(entry => entry.shared >= RecipientDirectoryModel.minSuggestionPrefixLength)
      .sort((left, right) => right.shared - left.shared || left.candidate.localeCompare(right.candidate))
      .slice(0, RecipientDirectoryModel.maxSuggestions)
      .map(entry => entry.candidate)
  }

  private static readonly matches = (input: { readonly requested: string; readonly candidateIds: readonly string[] }): boolean =>
    input.candidateIds.some(candidate => candidate === input.requested || asSessionId(candidate) === asSessionId(input.requested))
}

/** No live Agent or persisted Session has the requested id; nothing was stored. */
export class UnknownRecipient extends Schema.TaggedError<UnknownRecipient>()(
  'UnknownRecipient',
  {
    requestedId: Schema.String.check(Schema.isMaxLength(512)),
    suggestions: Schema.Array(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'unknown-recipient' },
) {
  override get message(): string {
    const closest = this.suggestions.length === 0 ? '' : ` Closest known ids: ${this.suggestions.join(', ')}.`
    return `No live Agent or persisted Session has the id "${this.requestedId}"; nothing was stored. Call dshx_comm_agents for valid ids.${closest}`
  }
}

/** Sending to a dormant Session must stay possible, so the whole persisted corpus is listed — but only on demand. */
const durableIdsTimeToLive = Duration.seconds(60)

export class RecipientDirectory extends Context.Service<
  RecipientDirectory,
  { readonly resolve: (toAgentId: string) => Effect.Effect<'live' | 'durable', UnknownRecipient> }
>()('@dshfiles/agent-communication/RecipientDirectory') {
  static readonly layer = Layer.effect(
    RecipientDirectory,
    Effect.gen(function* () {
      const agents = yield* HostAgents
      const corpus = yield* SessionCorpus
      const durableIds = yield* Cache.makeWith(() => Effect.map(corpus.listSessions, records => records.map(record => record.header.id)), {
        capacity: 1,
        timeToLive: exit => (Exit.isSuccess(exit) ? durableIdsTimeToLive : Duration.zero),
      })
      return RecipientDirectory.of({
        resolve: Effect.fn('agent communication resolve recipient')(function* (toAgentId) {
          const liveIds = (yield* agents.list).map(agent => agent.id)
          if (RecipientDirectoryModel.resolve({ requestedId: toAgentId, liveIds, durableIds: [] }).status === 'live') return 'live' as const
          const listed = yield* Effect.option(Cache.get(durableIds, 'corpus'))
          // Without a corpus listing there is nothing to check against, and a dormant recipient is legitimate: accept the id.
          if (Option.isNone(listed)) return 'durable' as const
          const resolution = RecipientDirectoryModel.resolve({ requestedId: toAgentId, liveIds, durableIds: listed.value })
          if (resolution.status !== 'unknown') return resolution.status
          return yield* new UnknownRecipient({ requestedId: toAgentId, suggestions: [...resolution.suggestions] })
        }),
      })
    }),
  )
}
