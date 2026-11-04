import { describe, expect, test } from 'vitest'
import { activityInputSchema, activityReportSchema, otelMetricsInputSchema, resolveActivityQuery, resolveOtelMetricsRange, usageApi } from './api.js'
import { Result } from 'effect'
import * as Schema from 'effect/Schema'

// oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown test input
const strictParse = <ValueSchema extends Schema.ConstraintDecoder<unknown>>(schema: ValueSchema, value: unknown): ValueSchema['Type'] =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(value)

// oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown test input
const strictAccepts = <ValueSchema extends Schema.ConstraintDecoder<unknown>>(schema: ValueSchema, value: unknown): boolean =>
  Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(value)._tag === 'Success'

const resolved = <A, E>(result: Result.Result<A, E>): A => Result.getOrThrow(result)
const rejection = <A>(result: Result.Result<A, { readonly message: string }>): string => (Result.isFailure(result) ? result.failure.message : '')

describe('usage tool exposure', () => {
  test('activity stats default to the last 30 days and support bounded ranked queries', () => {
    const defaults = resolved(resolveActivityQuery(strictParse(activityInputSchema, {}), 1_000_000))
    expect(defaults).toEqual({ from: 1_000_000 - 30 * 24 * 60 * 60 * 1_000, to: 1_000_000, limit: 10, bucket: 'day', tzOffsetMinutes: 0 })
    expect(resolved(resolveActivityQuery(strictParse(activityInputSchema, { days: 7, category: 'skill', limit: 5 }), 1_000_000))).toMatchObject({
      from: 1_000_000 - 7 * 24 * 60 * 60 * 1_000,
      to: 1_000_000,
      category: 'skill',
      limit: 5,
    })
    expect(resolved(resolveActivityQuery(strictParse(activityInputSchema, { from: 100, to: 200, limit: 25 }), 1_000_000))).toMatchObject({
      from: 100,
      to: 200,
      limit: 25,
    })
    expect(rejection(resolveActivityQuery(strictParse(activityInputSchema, { from: 100 }), 1_000_000))).toMatch(/both/u)
    expect(rejection(resolveActivityQuery(strictParse(activityInputSchema, { from: 200, to: 100 }), 1_000_000))).toMatch(/after/u)
    expect(
      resolved(resolveActivityQuery(strictParse(activityInputSchema, { from: 0, to: 3 * 24 * 60 * 60 * 1_000, bucket: 'hour' }), 1_000_000)),
    ).toMatchObject({
      bucket: 'day',
    })
    expect(resolved(resolveActivityQuery(strictParse(activityInputSchema, { from: 0, to: 60 * 60 * 1_000, bucket: 'hour' }), 1_000_000))).toMatchObject({
      bucket: 'hour',
    })
    expect(rejection(resolveActivityQuery(strictParse(activityInputSchema, { from: 100, to: 200, days: 7 }), 1_000_000))).toMatch(/cannot be combined/u)
    expect(rejection(resolveActivityQuery(strictParse(activityInputSchema, { to: 200, days: 7 }), 1_000_000))).toMatch(/cannot be combined/u)
    expect(strictAccepts(activityInputSchema, { query: 'secret' })).toBe(false)
    expect(strictAccepts(activityInputSchema, { eventLimit: 201 })).toBe(false)
    expect(strictAccepts(activityInputSchema, { from: 1, to: 2, category: 'not-a-category' })).toBe(false)
  })

  test('resolves bounded OTLP export ranges and exposes only a local read tool', () => {
    const defaults = resolved(resolveOtelMetricsRange(strictParse(otelMetricsInputSchema, {}), 2_000_000_000))
    expect(defaults).toEqual({ from: 0, to: 2_000_000_000 })
    expect(resolved(resolveOtelMetricsRange(strictParse(otelMetricsInputSchema, { days: 7 }), 2_000_000_000))).toEqual({
      from: 2_000_000_000 - 7 * 24 * 60 * 60 * 1_000,
      to: 2_000_000_000,
    })
    expect(resolved(resolveOtelMetricsRange(strictParse(otelMetricsInputSchema, { from: 1_000, to: 2_000 }), 2_000_000_000))).toEqual({
      from: 1_000,
      to: 2_000,
    })
    expect(rejection(resolveOtelMetricsRange(strictParse(otelMetricsInputSchema, { from: 1_000 }), 2_000_000_000))).toMatch(/both/u)
    expect(rejection(resolveOtelMetricsRange(strictParse(otelMetricsInputSchema, { from: 2_000, to: 1_000 }), 2_000_000_000))).toMatch(/after/u)
    expect(rejection(resolveOtelMetricsRange(strictParse(otelMetricsInputSchema, { days: 7, to: 2_000 }), 2_000_000_000))).toMatch(/cannot be combined/u)
    expect(
      rejection(resolveOtelMetricsRange(strictParse(otelMetricsInputSchema, { from: 1_000, to: 1_000 + 366 * 24 * 60 * 60 * 1_000 }), 2_000_000_000)),
    ).toMatch(/365 days/u)
    expect(strictAccepts(otelMetricsInputSchema, { from: Number.MAX_SAFE_INTEGER + 1, to: Number.MAX_SAFE_INTEGER + 2 })).toBe(false)
    const tool = usageApi.methods.otelMetrics.tool
    expect(tool?.name).toBe('usage_otel_metrics')
    expect(tool?.readOnly).toBe(true)
    expect(usageApi.methods.otelMetrics.description ?? '').toMatch(/makes no network request/u)
  })

  test('rejects inconsistent Jev totals and invalid event statuses', () => {
    const report = strictAccepts(activityReportSchema, {
      jev: { calls: 2, successes: 1, failures: 0, averageDurationMs: null },
    })
    expect(report).toBe(false)
    const invalidEvent = strictAccepts(activityReportSchema, {
      jev: { calls: 0, successes: 0, failures: 0, averageDurationMs: null },
      events: [{ kind: 'jev', at: 1, endedAt: 2, durationMs: 1, source: 'backlog', outcome: 'private-error' }],
    })
    expect(invalidEvent).toBe(false)
    const unknownSource = strictAccepts(activityReportSchema, {
      jev: { calls: 0, successes: 0, failures: 0, averageDurationMs: null },
      events: [{ kind: 'jev', at: 1, endedAt: 2, durationMs: 1, source: 'triage', outcome: 'success' }],
    })
    expect(unknownSource).toBe(false)
    const validEvent = strictAccepts(activityReportSchema, {
      tools: [],
      jev: { calls: 1, successes: 1, failures: 0, averageDurationMs: 1 },
      events: [{ kind: 'jev', at: 1, endedAt: 2, durationMs: 1, source: 'memory', outcome: 'success' }],
    })
    expect(validEvent).toBe(true)
  })

  test('new clients decode older Host activity rows with neutral source defaults', () => {
    const report = strictParse(activityReportSchema, {
      tools: [{ name: 'bash', calls: 1, errors: 0, interrupted: 0, unknown: 0, averageDurationMs: null }],
      jev: { calls: 0, successes: 0, failures: 0, averageDurationMs: null },
    })
    expect(report.tools[0]).toMatchObject({ category: 'other', owner: null })
  })

  test('index status and re-index are named tools', () => {
    const tools = Object.values(usageApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'usage_activity_report',
      'usage_jev_report',
      'usage_otel_metrics',
      'usage_reindex',
      'usage_report',
      'usage_requests',
      'usage_status',
    ])
    const readOnly = tools
      .filter(tool => tool.readOnly === true)
      .map(tool => tool.name)
      .sort()
    expect(readOnly).toEqual(['usage_activity_report', 'usage_jev_report', 'usage_otel_metrics', 'usage_report', 'usage_requests', 'usage_status'])
    expect(usageApi.methods.recordJevUsage.tool).toBeUndefined()
    expect(usageApi.methods.refresh.description ?? '').toMatch(/Call only when the user asked/u)
    expect(usageApi.methods.activity.description ?? '').toMatch(/last 30 days/u)
    expect(usageApi.methods.activity.description ?? '').toMatch(/which tools or skills do I use most/u)
    expect(usageApi.methods.activity.description ?? '').toMatch(/compound\/ambiguous shell commands are omitted/u)
  })

  test('Jev usage report is read-only and request recording stays internal', () => {
    expect(usageApi.methods.jevUsage.tool).toMatchObject({ name: 'usage_jev_report', readOnly: true })
    expect(usageApi.methods.recordJevUsage.tool).toBeUndefined()
  })
})
