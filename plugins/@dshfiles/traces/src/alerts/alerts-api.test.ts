import { describe, expect, test } from 'vitest'
import { tracesBoardsApi } from '../boards/boards-api.js'
import { TracesSchema } from '../schema.js'
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
    expect(TracesSchema.acceptsStrict(removeInputSchema, { id: 'rule-1' })).toBe(false)
    expect(TracesSchema.acceptsStrict(removeInputSchema, { id: 'rule-1', confirm: false })).toBe(false)
    expect(TracesSchema.acceptsStrict(removeInputSchema, { id: 'rule-1', confirm: true })).toBe(true)
  })

  test('mute takes minutes within a week, or null to unmute', () => {
    expect(TracesSchema.acceptsStrict(muteInputSchema, { id: 'rule-1', minutes: 60 })).toBe(true)
    expect(TracesSchema.acceptsStrict(muteInputSchema, { id: 'rule-1', minutes: null })).toBe(true)
    expect(TracesSchema.acceptsStrict(muteInputSchema, { id: 'rule-1', minutes: 0 })).toBe(false)
    expect(TracesSchema.acceptsStrict(muteInputSchema, { id: 'rule-1', minutes: 7 * 24 * 60 + 1 })).toBe(false)
    expect(TracesSchema.acceptsStrict(muteInputSchema, { id: 'rule-1' })).toBe(false)
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
      expect(TracesSchema.acceptsStrict(alertRuleDraftSchema, { ...draft, kind, threshold, filter })).toBe(true)
  })

  test('refuses an error-rate threshold above 1 but allows it for other kinds', () => {
    expect(TracesSchema.acceptsStrict(alertRuleDraftSchema, { ...draft, threshold: 20 })).toBe(false)
    expect(TracesSchema.acceptsStrict(alertRuleDraftSchema, { ...draft, kind: 'latency', threshold: 20 })).toBe(true)
  })

  test('refuses windows, percentiles, ids and attribute keys outside the contract', () => {
    expect(TracesSchema.acceptsStrict(alertRuleDraftSchema, { ...draft, windowMinutes: 0 })).toBe(false)
    expect(TracesSchema.acceptsStrict(alertRuleDraftSchema, { ...draft, windowMinutes: 24 * 60 + 1 })).toBe(false)
    expect(TracesSchema.acceptsStrict(alertRuleDraftSchema, { ...draft, percentile: 75 })).toBe(false)
    expect(TracesSchema.acceptsStrict(alertRuleDraftSchema, { ...draft, threshold: -1 })).toBe(false)
    expect(TracesSchema.acceptsStrict(alertRuleDraftSchema, { ...draft, id: 'Rule One' })).toBe(false)
    expect(TracesSchema.acceptsStrict(alertRuleDraftSchema, { ...draft, filter: { ...draft.filter, attribute: { key: 'a"b', value: 'x' } } })).toBe(false)
    expect(TracesSchema.acceptsStrict(alertRuleDraftSchema, { ...draft, name: '  ' })).toBe(false)
    expect(TracesSchema.acceptsStrict(alertRuleDraftSchema, { ...draft, extra: true })).toBe(false)
  })
})
