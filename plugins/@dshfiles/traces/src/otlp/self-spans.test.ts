import { describe, expect, test } from 'vitest'
import { ALERT_EVALUATION_SPAN } from '../alerts/alert-engine.js'
import { OtlpBody } from './decode.js'
import { SpanNormalizer } from './normalize.js'

type Attribute = { readonly key: string; readonly value: { readonly stringValue: string } | { readonly intValue: string } }

const request = (spans: readonly { readonly name: string; readonly attributes: readonly Attribute[]; readonly statusCode?: number }[]) => ({
  body: Buffer.from(
    JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'dshfiles' } }] },
          scopeSpans: [
            {
              spans: spans.map((span, index) => ({
                traceId: String(index + 1).padStart(32, '0'),
                spanId: String(index + 1).padStart(16, '0'),
                name: span.name,
                kind: 1,
                startTimeUnixNano: '1700000000000000000',
                endTimeUnixNano: '1700000000100000000',
                attributes: span.attributes,
                status: { code: span.statusCode ?? 0 },
              })),
            },
          ],
        },
      ],
    }),
  ),
  wire: 'json' as const,
})

const apiSpan = (apiId: string) => ({ name: `${apiId}/state`, attributes: [{ key: 'dshx.api.id', value: { stringValue: apiId } }] })
const evaluation = (transitions: number, statusCode = 0) => ({
  name: ALERT_EVALUATION_SPAN,
  attributes: [{ key: 'dshx.traces.transitions', value: { intValue: String(transitions) } }],
  statusCode,
})

describe('own spans at ingest', () => {
  test('drops the dispatch spans of every traces API, so panel and notifier polling never trace themselves', () => {
    const result = SpanNormalizer.normalizeTraces(
      OtlpBody.decodeTraces(request([apiSpan('traces'), apiSpan('traces-alerts'), apiSpan('traces-boards'), apiSpan('jujutsu')])),
      { redactContent: true },
    )
    expect(result.spans.map(span => span.name)).toEqual(['jujutsu/state'])
    expect(result.skippedSelf).toBe(3)
  })

  test('keeps an alert evaluation that changed a rule or failed, and drops a routine one', () => {
    const result = SpanNormalizer.normalizeTraces(OtlpBody.decodeTraces(request([evaluation(0), evaluation(1), evaluation(0, 2)])), { redactContent: true })
    expect(result.spans.map(span => [span.name, span.statusCode, span.attributes['dshx.traces.transitions']])).toEqual([
      [ALERT_EVALUATION_SPAN, 0, 1],
      [ALERT_EVALUATION_SPAN, 2, 0],
    ])
  })
})
