import { describe, expect, test } from 'vitest'
import { tracesBoardsApi } from '../boards/boards-api.js'
import { ALERT_KINDS, alertRuleDraftSchema } from './alert-types.js'
import { muteInputSchema, removeInputSchema, tracesAlertsApi } from './alerts-api.js'

const toolsOf = (methods: Readonly<Record<string, { readonly tool?: { readonly name: string; readonly readOnly?: boolean } | undefined }>>) =>
  Object.values(methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))

const draft = {
  name: 'Rule',
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
  markThreads: false,
} as const

describe('alert and board agent tools', () => {
  test('alerts read with one tool and write with four, boards only read', () => {
    const alertTools = toolsOf(tracesAlertsApi.methods)
    expect(alertTools.map(tool => tool.name).sort()).toEqual([
      'traces_alert_delete',
      'traces_alert_mute',
      'traces_alert_save',
      'traces_alerts',
      'traces_alerts_evaluate',
    ])
    expect(alertTools.filter(tool => tool.readOnly === true).map(tool => tool.name)).toEqual(['traces_alerts'])
    expect(toolsOf(tracesBoardsApi.methods)).toEqual([expect.objectContaining({ name: 'traces_breakdown', readOnly: true })])
    for (const method of [...Object.values(tracesAlertsApi.methods), ...Object.values(tracesBoardsApi.methods)]) expect(method.description).toBeTruthy()
    for (const method of [tracesAlertsApi.methods.save, tracesAlertsApi.methods.mute, tracesAlertsApi.methods.remove, tracesAlertsApi.methods.evaluate])
      expect(method.description).toContain('only when the user asked')
  })

  test('delete refuses to run without an explicit confirm', () => {
    expect(removeInputSchema.safeParse({ id: 'rule-1' }).success).toBe(false)
    expect(removeInputSchema.safeParse({ id: 'rule-1', confirm: false }).success).toBe(false)
    expect(removeInputSchema.safeParse({ id: 'rule-1', confirm: true }).success).toBe(true)
  })

  test('mute takes minutes within a week, or null to unmute', () => {
    expect(muteInputSchema.safeParse({ id: 'rule-1', minutes: 60 }).success).toBe(true)
    expect(muteInputSchema.safeParse({ id: 'rule-1', minutes: null }).success).toBe(true)
    expect(muteInputSchema.safeParse({ id: 'rule-1', minutes: 0 }).success).toBe(false)
    expect(muteInputSchema.safeParse({ id: 'rule-1', minutes: 7 * 24 * 60 + 1 }).success).toBe(false)
    expect(muteInputSchema.safeParse({ id: 'rule-1' }).success).toBe(false)
  })
})

describe('alert rule drafts', () => {
  test.each(ALERT_KINDS)('accepts a %s rule with every filter shape', kind => {
    const threshold = kind === 'error-rate' ? 0.5 : 1_000
    for (const filter of [
      { service: null, operation: null, attribute: null },
      { service: 'deepseek-harness', operation: 'jj *', attribute: null },
      { service: null, operation: 'chat deepseek', attribute: { key: 'gen_ai.provider.name', value: 'deepseek' } },
      { service: null, operation: null, attribute: { key: 'rpc.system', value: '*' } },
    ])
      expect(alertRuleDraftSchema.safeParse({ ...draft, kind, threshold, filter }).success).toBe(true)
  })

  test('refuses an error-rate threshold above 1 but allows it for other kinds', () => {
    expect(alertRuleDraftSchema.safeParse({ ...draft, threshold: 20 }).success).toBe(false)
    expect(alertRuleDraftSchema.safeParse({ ...draft, kind: 'latency', threshold: 20 }).success).toBe(true)
  })

  test('refuses windows, percentiles, ids and attribute keys outside the contract', () => {
    expect(alertRuleDraftSchema.safeParse({ ...draft, windowMinutes: 0 }).success).toBe(false)
    expect(alertRuleDraftSchema.safeParse({ ...draft, windowMinutes: 24 * 60 + 1 }).success).toBe(false)
    expect(alertRuleDraftSchema.safeParse({ ...draft, percentile: 75 }).success).toBe(false)
    expect(alertRuleDraftSchema.safeParse({ ...draft, threshold: -1 }).success).toBe(false)
    expect(alertRuleDraftSchema.safeParse({ ...draft, id: 'Rule One' }).success).toBe(false)
    expect(alertRuleDraftSchema.safeParse({ ...draft, filter: { ...draft.filter, attribute: { key: 'a"b', value: 'x' } } }).success).toBe(false)
    expect(alertRuleDraftSchema.safeParse({ ...draft, name: '  ' }).success).toBe(false)
    expect(alertRuleDraftSchema.safeParse({ ...draft, extra: true }).success).toBe(false)
  })
})
