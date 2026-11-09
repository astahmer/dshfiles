import { defineApi, event, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))

const ONLY_WHEN_ASKED = 'Call only when the user asked for this.'

/**
 * One edge: the subscriber thread gets a compact notice when the target thread finishes a turn. Nothing wakes a
 * thread without an edge, so a thread started with `thread_create`/`thread_fork` stays silent.
 */
export const threadSubscriptionSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    subscriberSessionId: sessionIdSchema,
    targetSessionId: sessionIdSchema,
    createdAt: Schema.Number.check(Schema.isFinite()),
    subscriberTitle: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
    targetTitle: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  }),
)

export const threadSubscriptionsSchema = SchemaHelpers.strictStruct(
  Schema.Struct({ subscriptions: Schema.Array(threadSubscriptionSchema).check(Schema.isMaxLength(500)) }),
)

export type ThreadSubscription = Schema.Schema.Type<typeof threadSubscriptionSchema>
export type ThreadSubscriptionsSnapshot = Schema.Schema.Type<typeof threadSubscriptionsSchema>

const label = (title: string | undefined, sessionId: string): string => (title === undefined ? sessionId : `${title} (${sessionId})`)

const renderSubscriptions = (output: ThreadSubscriptionsSnapshot): string =>
  output.subscriptions.length === 0
    ? 'No thread subscriptions: nothing is notified when another thread finishes.'
    : output.subscriptions
        .map(row => `${label(row.subscriberTitle, row.subscriberSessionId)} is notified when ${label(row.targetTitle, row.targetSessionId)} finishes`)
        .join('\n')

/**
 * Opt-in completion notices between threads. An Agent subscribes the thread it runs before ending a turn that waits
 * on another thread; while subscribed, that thread's turn completion queues one compact notice into the subscriber,
 * which wakes it when it is idle. The subscription is durable Host state and shows in the sidebar's thread menu.
 *
 * The tool inputs are plain `Schema.Struct`, never `SchemaHelpers.strictStruct`: a strict-Struct wrapper publishes no
 * object JSON Schema, so dshx registers the tool as taking no arguments and every call fails input validation. The
 * contract's own Standard Schema adapter still rejects unknown keys (`onExcessProperty: 'error'`).
 */
export const threadSubscriptionsApi = defineApi({
  id: 'thread-subscriptions',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    state: method({
      input: Schema.Struct({
        subscriberSessionId: Schema.optional(sessionIdSchema),
        targetSessionId: Schema.optional(sessionIdSchema),
      }),
      output: threadSubscriptionsSchema,
      description:
        'List thread subscriptions: which thread is notified when which other thread finishes a turn. Filter by subscriber or target; omit both for every edge. Nothing is delivered without a subscription. Read-only.',
      tool: { name: 'thread_subscriptions', readOnly: true, render: renderSubscriptions },
    }),
    subscribe: method({
      input: Schema.Struct({ sessionId: sessionIdSchema, subscriberSessionId: Schema.optional(sessionIdSchema) }),
      output: threadSubscriptionsSchema,
      description: `Subscribe a thread to another thread's turn completions: when the target finishes, fails, or stops to ask a question, one compact notice (status plus a short answer preview, never the transcript) is queued into the subscriber and wakes it when it is idle. Defaults the subscriber to the calling thread. Refused for a thread watching itself or a pair that would wake each other. Call it when the user asked you to wait on another thread's result, or right before you end a turn that waits on one — the subscription is that opt-in, and without it nothing wakes you.`,
      tool: {
        name: 'thread_subscribe',
        render: output =>
          output.subscriptions.map(row => `${row.subscriberSessionId} is notified when ${row.targetSessionId} finishes`).join('\n') ||
          'No subscription was stored.',
      },
    }),
    unsubscribe: method({
      input: Schema.Struct({ sessionId: sessionIdSchema, subscriberSessionId: Schema.optional(sessionIdSchema) }),
      output: threadSubscriptionsSchema,
      description: `Stop the notices for one pair: no further completion of the target reaches the subscriber. Defaults the subscriber to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'thread_unsubscribe',
        render: output =>
          output.subscriptions.length === 0
            ? 'No thread subscriptions remain.'
            : output.subscriptions.map(row => `${row.subscriberSessionId} is notified when ${row.targetSessionId} finishes`).join('\n'),
      },
    }),
  },
  events: {
    changed: event({
      schema: Schema.Struct({ revision: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)) }),
      description: 'Subscriptions changed (an Agent or another surface subscribed, unsubscribed, or an archived endpoint was dropped); read the state again.',
    }),
  },
})
