import * as Schema from 'effect/Schema'
import { describe, expect, test } from 'vitest'
import { clearInputSchema, reclaimInputSchema, tracesApi } from './api.js'

// oxlint-disable-next-line antislop/no-unknown-parameters -- test boundary: the schema parses the unknown value
const acceptsStrict = <S extends Schema.Decoder<unknown>>(schema: S, value: unknown): boolean =>
  Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(value)._tag === 'Success'

describe('traces agent tools', () => {
  test('every traces capability is a named tool and only clear and reclaim write', () => {
    const tools = Object.values(tracesApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'traces_clear',
      'traces_error_groups',
      'traces_get',
      'traces_get_metric',
      'traces_list_metrics',
      'traces_list_services',
      'traces_reclaim_space',
      'traces_search',
      'traces_search_logs',
      'traces_service_map',
      'traces_session_summary',
      'traces_stalls',
      'traces_status',
      'traces_store_space',
    ])
    expect(
      tools
        .filter(tool => tool.readOnly !== true)
        .map(tool => tool.name)
        .sort(),
    ).toEqual(['traces_clear', 'traces_reclaim_space'])
    for (const method of Object.values(tracesApi.methods)) expect(method.description).toBeTruthy()
  })

  test('clear refuses to run without an explicit confirm', () => {
    expect(acceptsStrict(clearInputSchema, {})).toBe(false)
    expect(acceptsStrict(clearInputSchema, { confirm: false })).toBe(false)
    expect(acceptsStrict(clearInputSchema, { confirm: true })).toBe(true)
  })

  test('reclaim refuses to run without an explicit confirm', () => {
    expect(acceptsStrict(reclaimInputSchema, {})).toBe(false)
    expect(acceptsStrict(reclaimInputSchema, { confirm: false })).toBe(false)
    expect(acceptsStrict(reclaimInputSchema, { confirm: true })).toBe(true)
  })
})
