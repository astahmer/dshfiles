import { defineApi, method } from '@dshfiles/dshx/api'
import { SessionId } from '@dshfiles/dshx/ids'
import { Schema } from 'effect'

const tokens = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const compactionThresholdSchema = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  /** False when the profile turned automatic compaction off; `thresholdTokens` is then what `/compact` policy would use. */
  auto: Schema.Boolean,
  contextWindow: tokens,
  thresholdTokens: tokens,
  /** The engine's own pressure reading (`tokenMeter.measure().totalTokens`); null without a live Session or meter. */
  usedTokens: Schema.NullOr(tokens),
})

export type CompactionThreshold = typeof compactionThresholdSchema.Type

export const compactionApi = defineApi({
  id: 'context-compaction',
  version: 1,
  owner: '@dshfiles/context-compaction',
  methods: {
    threshold: method({
      input: Schema.Struct({ sessionId: SessionId }),
      output: Schema.NullOr(compactionThresholdSchema),
      description:
        'Read the token count at which automatic compaction next runs for one live thread, from its routed model, context window, output reservation and the compaction policy. Null before the thread routed a request, when the route declares no context window, or when the policy leaves no pressure budget.',
      tool: {
        name: 'compaction_threshold',
        readOnly: true,
        render: output => JSON.stringify(output),
      },
    }),
  },
})
