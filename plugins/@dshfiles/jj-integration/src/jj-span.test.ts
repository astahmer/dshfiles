import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { traceJjExecutor } from './jj-span.js'

describe('jj executor span', () => {
  it('records a jj workspace span with the exit code and marks a failed run', async () => {
    using recorder = recordSpans()
    const execute = traceJjExecutor(async () => ({ exitCode: 1, stdout: '', stderr: '', stdoutLossy: false }))
    await execute({ args: ['workspace', 'add', '--name', 'topic', '/private/tmp/topic'], cwd: '/private/tmp/repo' })
    const span = recorder.span('jj workspace add')
    expect(span.attributes['process.exit.code']).toBe(1)
    expect(span.status.code).toBe('error')
    expect(JSON.stringify(span.attributes)).not.toContain('/private/tmp')
  })
})
