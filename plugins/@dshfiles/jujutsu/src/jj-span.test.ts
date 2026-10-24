import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { withJjSpan } from './jj-span.js'

describe('jj span', () => {
  it('records a jj log span with flag names only and whether output was cut', async () => {
    using recorder = recordSpans()
    await withJjSpan({ args: ['log', '-r', 'secret-revset', '-T', 'description'], run: async () => ({ truncated: true }) })
    const span = recorder.span('jj log')
    expect(span.kind).toBe('client')
    expect(span.attributes['jj.output.truncated']).toBe(true)
    expect(JSON.stringify(span.attributes)).not.toMatch(/secret-revset|description/)
  })
})
