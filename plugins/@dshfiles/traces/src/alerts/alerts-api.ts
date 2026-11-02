import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { alertFeedSchema, alertRuleDraftSchema, alertRuleSchema, alertsSnapshotSchema, evaluationSummarySchema } from './alert-types.js'

const ruleIdSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/)).annotate({ description: 'Alert rule id from traces_alerts.' })

export const muteInputSchema = Schema.Struct({
  id: ruleIdSchema,
  minutes: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(7 * 24 * 60))).annotate({
    description: 'Mute for this many minutes; null unmutes. A muted rule still evaluates but announces nothing.',
  }),
})

export const removeInputSchema = Schema.Struct({
  id: ruleIdSchema,
  confirm: Schema.Literal(true).annotate({ description: 'Must be true: removing a rule drops its state; its history stays.' }),
})

const compactJson = <Output>(output: Output): string => JSON.stringify(output)

/** A contract of its own, so alert changes never touch the trace query surface other plugins and clients call. */
export const tracesAlertsApi = defineApi({
  id: 'traces-alerts',
  version: 1,
  owner: '@dshfiles/traces',
  methods: {
    state: method({
      input: Schema.Struct({
        historyLimit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(200))).annotate({
          description: 'Newest history events to include; defaults to 50.',
        }),
      }),
      output: alertsSnapshotSchema,
      description:
        'Alert rules over stored telemetry (error rate, latency percentile, throughput, span count, span duration), each with its filter, window, threshold, severity, enabled and mute state, and current state (ok or firing, last value, sample count); how many fire now; and the newest firing/resolved events with the threads they named. Read-only.',
      tool: { name: 'traces_alerts', readOnly: true, render: compactJson },
    }),
    feed: method({
      input: Schema.Struct({
        afterId: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
          description: 'Last event id seen; null returns only the latest id.',
        }),
      }),
      output: alertFeedSchema,
      description: 'Alert events newer than an id, newest first (at most 20), with the latest id and the firing count; what a notifier polls.',
    }),
    save: method({
      input: alertRuleDraftSchema,
      output: alertRuleSchema,
      description:
        'Create an alert rule (omit id) or replace one (pass its id): kind, span filter (service, span name with a trailing * as prefix, one attribute), window, threshold, comparator, percentile, minimum samples, severity, enabled, notify and mark-threads. Disabling a firing rule resolves it. Run only when the user asked to create, edit, enable or disable an alert rule.',
      tool: { name: 'traces_alert_save', readOnly: false, render: compactJson },
    }),
    mute: method({
      input: muteInputSchema,
      output: alertRuleSchema,
      description: 'Mute or unmute one alert rule. Run only when the user asked to mute or unmute it.',
      tool: { name: 'traces_alert_mute', readOnly: false, render: compactJson },
    }),
    remove: method({
      input: removeInputSchema,
      output: alertRuleSchema,
      description: 'Remove one alert rule; a firing one is resolved first. Run only when the user asked to delete that rule, and pass confirm: true.',
      tool: { name: 'traces_alert_delete', readOnly: false, render: compactJson },
    }),
    evaluate: method({
      input: Schema.Struct({}),
      output: evaluationSummarySchema,
      description:
        'Evaluate every enabled alert rule now instead of at the next minute; transitions are recorded and announced as on the timer. Run only when the user asked to evaluate alerts now.',
      tool: { name: 'traces_alerts_evaluate', readOnly: false, render: compactJson },
    }),
  },
})
