import { describe, expect, test } from 'vitest'
import { activityInputSchema, activityReportSchema, otelMetricsInputSchema, resolveActivityQuery, resolveOtelMetricsRange, usageApi } from './api.js'

describe('usage tool exposure', () => {
  test('activity stats default to the last 30 days and support bounded ranked queries', () => {
    const defaults = resolveActivityQuery(activityInputSchema.parse({}), 1_000_000)
    expect(defaults).toEqual({ from: 1_000_000 - 30 * 24 * 60 * 60 * 1_000, to: 1_000_000, limit: 10 })
    expect(resolveActivityQuery(activityInputSchema.parse({ days: 7, category: 'skill', limit: 5 }), 1_000_000)).toMatchObject({
      from: 1_000_000 - 7 * 24 * 60 * 60 * 1_000,
      to: 1_000_000,
      category: 'skill',
      limit: 5,
    })
    expect(resolveActivityQuery(activityInputSchema.parse({ from: 100, to: 200, limit: 25 }), 1_000_000)).toMatchObject({
      from: 100,
      to: 200,
      limit: 25,
    })
    expect(() => resolveActivityQuery(activityInputSchema.parse({ from: 100 }), 1_000_000)).toThrow(/both/u)
    expect(() => resolveActivityQuery(activityInputSchema.parse({ from: 200, to: 100 }), 1_000_000)).toThrow(/after/u)
    expect(() => resolveActivityQuery(activityInputSchema.parse({ from: 100, to: 200, days: 7 }), 1_000_000)).toThrow(/cannot be combined/u)
    expect(() => resolveActivityQuery(activityInputSchema.parse({ to: 200, days: 7 }), 1_000_000)).toThrow(/cannot be combined/u)
    expect(activityInputSchema.safeParse({ query: 'secret' }).success).toBe(false)
    expect(activityInputSchema.safeParse({ eventLimit: 201 }).success).toBe(false)
    expect(activityInputSchema.safeParse({ from: 1, to: 2, category: 'not-a-category' }).success).toBe(false)
  })

  test('resolves bounded OTLP export ranges and exposes only a local read tool', () => {
    const defaults = resolveOtelMetricsRange(otelMetricsInputSchema.parse({}), 2_000_000_000)
    expect(defaults).toEqual({ from: 0, to: 2_000_000_000 })
    expect(resolveOtelMetricsRange(otelMetricsInputSchema.parse({ days: 7 }), 2_000_000_000)).toEqual({
      from: 2_000_000_000 - 7 * 24 * 60 * 60 * 1_000,
      to: 2_000_000_000,
    })
    expect(resolveOtelMetricsRange(otelMetricsInputSchema.parse({ from: 1_000, to: 2_000 }), 2_000_000_000)).toEqual({ from: 1_000, to: 2_000 })
    expect(() => resolveOtelMetricsRange(otelMetricsInputSchema.parse({ from: 1_000 }), 2_000_000_000)).toThrow(/both/u)
    expect(() => resolveOtelMetricsRange(otelMetricsInputSchema.parse({ from: 2_000, to: 1_000 }), 2_000_000_000)).toThrow(/after/u)
    expect(() => resolveOtelMetricsRange(otelMetricsInputSchema.parse({ days: 7, to: 2_000 }), 2_000_000_000)).toThrow(/cannot be combined/u)
    expect(() => resolveOtelMetricsRange(otelMetricsInputSchema.parse({ from: 1_000, to: 1_000 + 366 * 24 * 60 * 60 * 1_000 }), 2_000_000_000)).toThrow(
      /365 days/u,
    )
    expect(otelMetricsInputSchema.safeParse({ from: Number.MAX_SAFE_INTEGER + 1, to: Number.MAX_SAFE_INTEGER + 2 }).success).toBe(false)
    const tool = usageApi.methods.otelMetrics.tool
    expect(tool?.name).toBe('usage_otel_metrics')
    expect(tool?.readOnly).toBe(true)
    expect(usageApi.methods.otelMetrics.description ?? '').toMatch(/makes no network request/u)
  })

  test('rejects inconsistent Jev totals and invalid event statuses', () => {
    const report = activityReportSchema.safeParse({
      jev: { calls: 2, successes: 1, failures: 0, averageDurationMs: null },
    })
    expect(report.success).toBe(false)
    const invalidEvent = activityReportSchema.safeParse({
      jev: { calls: 0, successes: 0, failures: 0, averageDurationMs: null },
      events: [{ kind: 'jev', at: 1, endedAt: 2, durationMs: 1, source: 'backlog', outcome: 'private-error' }],
    })
    expect(invalidEvent.success).toBe(false)
    const unknownSource = activityReportSchema.safeParse({
      jev: { calls: 0, successes: 0, failures: 0, averageDurationMs: null },
      events: [{ kind: 'jev', at: 1, endedAt: 2, durationMs: 1, source: 'triage', outcome: 'success' }],
    })
    expect(unknownSource.success).toBe(false)
    const validEvent = activityReportSchema.safeParse({
      tools: [],
      jev: { calls: 1, successes: 1, failures: 0, averageDurationMs: 1 },
      events: [{ kind: 'jev', at: 1, endedAt: 2, durationMs: 1, source: 'memory', outcome: 'success' }],
    })
    expect(validEvent.success).toBe(true)
  })

  test('new clients decode older Host activity rows with neutral source defaults', () => {
    const report = activityReportSchema.parse({
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
    expect(usageApi.methods.activity.description ?? '').toMatch(/which commands or tests took the most time/u)
    expect(usageApi.methods.activity.description ?? '').toMatch(/compound\/ambiguous shell commands are omitted/u)
  })

  test('Jev usage report is read-only and request recording stays internal', () => {
    expect(usageApi.methods.jevUsage.tool).toMatchObject({ name: 'usage_jev_report', readOnly: true })
    expect(usageApi.methods.recordJevUsage.tool).toBeUndefined()
  })
})
