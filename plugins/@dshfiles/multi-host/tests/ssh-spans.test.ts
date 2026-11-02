import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { Ssh } from '../src/ssh.js'
import { sshLayer } from './fixtures/ssh-runtime.js'

describe('ssh spans', () => {
  it('records an ssh command span that fails on a refused target before ssh starts', async () => {
    using recorder = recordSpans()
    const exit = await Effect.runPromiseExit(
      Ssh.use(ssh => ssh.run({ sshTarget: '-oProxyCommand=evil', command: 'true' })).pipe(Effect.provide(sshLayer), Effect.provide(tracerLayer)),
    )
    expect(exit._tag).toBe('Failure')
    const span = recorder.span('ssh command')
    expect(span.status.code).toBe('error')
    expect(JSON.stringify(span.attributes)).not.toContain('evil')
  })
})
