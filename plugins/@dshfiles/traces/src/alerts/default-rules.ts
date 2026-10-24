import type { AlertRuleDraft } from './alert-types.js'

type BuiltinDraft = AlertRuleDraft & { readonly id: string }

/**
 * Shipped enabled with conservative thresholds: each one names a failure a person would want to hear about, needs enough
 * spans to mean it, and only announces in-app (browser notifications need the user's permission first). Edits and removals
 * stick: the rules are seeded once, when the alert store is created.
 */
export const DEFAULT_ALERT_RULES: readonly BuiltinDraft[] = [
  {
    id: 'builtin-model-errors',
    name: 'Model call error rate',
    kind: 'error-rate',
    filter: { service: null, operation: 'chat *', attribute: null },
    windowMinutes: 10,
    threshold: 0.2,
    comparator: 'above',
    percentile: 95,
    minSamples: 5,
    severity: 'warning',
    enabled: true,
    notify: true,
    markThreads: true,
  },
  {
    id: 'builtin-jj-latency',
    name: 'Slow jj commands',
    kind: 'latency',
    filter: { service: null, operation: 'jj *', attribute: null },
    windowMinutes: 15,
    threshold: 5_000,
    comparator: 'above',
    percentile: 95,
    minSamples: 5,
    severity: 'warning',
    enabled: true,
    notify: true,
    markThreads: false,
  },
  {
    id: 'builtin-long-turn',
    name: 'Agent turn over 15 minutes',
    kind: 'duration',
    filter: { service: null, operation: 'invoke_agent*', attribute: null },
    windowMinutes: 30,
    threshold: 15 * 60_000,
    comparator: 'above',
    percentile: 95,
    minSamples: 1,
    severity: 'info',
    enabled: true,
    notify: true,
    markThreads: true,
  },
  {
    id: 'builtin-plugin-api-errors',
    name: 'Plugin API error rate',
    kind: 'error-rate',
    filter: { service: null, operation: null, attribute: { key: 'rpc.system', value: 'dshx' } },
    windowMinutes: 10,
    threshold: 0.2,
    comparator: 'above',
    percentile: 95,
    minSamples: 20,
    severity: 'warning',
    enabled: false,
    notify: true,
    markThreads: false,
  },
]
