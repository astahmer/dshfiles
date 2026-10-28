import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { withJjSpan } from './jj-span.js'

describe('jj span', () => {
  it('records colocated initialization without configuration values or paths', async () => {
    using recorder = recordSpans()
    await withJjSpan({
      args: ['--config=snapshot.auto-track=none()', 'git', 'init', '--colocate'],
      run: async () => ({ truncated: false }),
    })
    const span = recorder.span('jj git init')
    expect(span.kind).toBe('client')
    expect(span.attributes['jj.output.truncated']).toBe(false)
    expect(JSON.stringify(span.attributes)).not.toMatch(/snapshot\.auto-track|none\(\)/)
  })

  it('records a jj log span with flag names only and whether output was cut', async () => {
    using recorder = recordSpans()
    await withJjSpan({ args: ['log', '-r', 'secret-revset', '-T', 'description'], run: async () => ({ truncated: true }) })
    const span = recorder.span('jj log')
    expect(span.kind).toBe('client')
    expect(span.attributes['jj.output.truncated']).toBe(true)
    expect(JSON.stringify(span.attributes)).not.toMatch(/secret-revset|description/)
  })
})
