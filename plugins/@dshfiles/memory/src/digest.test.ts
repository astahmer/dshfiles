import { describe, expect, it } from 'vitest'

import { readThread } from './digest.ts'
import { createThread } from './testing/session-fixture.ts'

const header = { id: 'session-3f2a9c1e-0000-4000-8000-000000000001', cwd: '/work/halyard' }
const now = 1_760_100_000_000

describe('thread digest', () => {
  it('builds a digest from the thread record without a model call', () => {
    const thread = createThread(header)
    thread.title('Fix the consumer rebalance storm')
    thread.exchange('The coordinator restarts on every config push. Find out why and fix it in broker/coordinator.ts.', 'Looking into it.', [
      ['read', { file_path: 'broker/coordinator.ts' }, 'export const restartOnPush = true'],
    ])
    thread.todos([
      { content: 'Stop restarting coordinators on config push', status: 'completed' },
      { content: 'Add a regression test', status: 'pending' },
    ])
    thread.exchange('Ship it, and describe the revision.', 'Coordinators now reload config in place; INC-20931 cannot recur from a config push.', [
      ['edit', { file_path: 'broker/coordinator.ts', old_string: 'true', new_string: 'false' }, 'ok'],
      ['bash', { command: 'jj describe -m "fix(broker): reload coordinator config in place (INC-20931)"' }, 'Working copy now at: abc'],
    ])
    const material = readThread({ header, project: '/work/halyard', events: thread.events, now })
    expect(material.needsModel).toBe(false)
    expect(material.digest?.source).toBe('trail')
    expect(material.digest?.decision).toBe('fix(broker): reload coordinator config in place (INC-20931)')
    const digest = material.digest?.digest ?? ''
    expect(digest).toContain('Fix the consumer rebalance storm — halyard')
    expect(digest).toContain('1. The coordinator restarts on every config push. Find out why and fix it in broker/coordinator.ts.')
    expect(digest).toContain('Revisions: fix(broker): reload coordinator config in place (INC-20931)')
    expect(digest).toContain('Status: unfinished, 1 open todo(s)')
    expect(digest).toContain('[x] Stop restarting coordinators on config push; [ ] Add a regression test')
    expect(digest).toContain('Files changed: broker/coordinator.ts')
    expect(digest).toContain("Agent's last answer: Coordinators now reload config in place; INC-20931 cannot recur")
    expect(material.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  })

  it('skips blank and trivial threads', () => {
    const blank = createThread(header)
    blank.injected('Runtime context: cwd /work/halyard')
    expect(readThread({ header, project: '/work/halyard', events: blank.events, now }).digest).toBeUndefined()
    const hello = createThread(header)
    hello.exchange('hi', 'Hello! How can I help?')
    expect(readThread({ header, project: '/work/halyard', events: hello.events, now }).digest).toBeUndefined()
  })

  it("keeps the user's corrections and decisions verbatim, apart from the agent's answer", () => {
    const thread = createThread(header)
    thread.exchange('Rename the retention flag to retention.hours across the CLI.', 'Renamed it to retentionHours in every command.')
    thread.exchange("No, that's wrong: the flag must stay snake_case, retention_hours, because the ops scripts parse it.", 'Reverted to retention_hours.')
    thread.exchange("Let's go with 240 hours for Northwind and keep 72 as the default.", 'Done: Northwind 240 h, default 72 h.')
    const digest = readThread({ header, project: '/work/halyard', events: thread.events, now }).digest?.digest ?? ''
    expect(digest).toContain(`- [correction] "No, that's wrong: the flag must stay snake_case, retention_hours, because the ops scripts parse it."`)
    expect(digest).toContain(`- [decision] "Let's go with 240 hours for Northwind and keep 72 as the default."`)
    expect(digest.indexOf('User said (verbatim):')).toBeLessThan(digest.indexOf("Agent's last answer:"))
  })

  it('asks for a model only when the thread leaves no trail of its own', () => {
    const thread = createThread(header)
    thread.exchange('Look at the gateway logs and tell me what you see.', 'Checking.', [
      ['bash', { command: 'wc -l logs/api-gateway.log' }, '48210 logs/api-gateway.log'],
    ])
    thread.exchange('And the worker log?', 'Ok.', [['bash', { command: 'grep -c retry logs/worker.log' }, '312']])
    const material = readThread({ header, project: '/work/halyard', events: thread.events, now })
    expect(material.digest).toBeDefined()
    expect(material.needsModel).toBe(true)
    expect(material.transcript).toContain('[user #')
  })

  it('redacts credentials before anything is indexed or digested', () => {
    const thread = createThread(header)
    thread.exchange(
      'Use this key for the staging API: sk-proj-abcdefghijklmnopqrstuvwx and open http://127.0.0.1:3080/?token=deadbeefcafe0123 to check.',
      'Configured staging with the provided key; the dashboard loads.',
    )
    const material = readThread({ header, project: '/work/halyard', events: thread.events, now })
    const stored = [material.digest?.digest ?? '', ...material.messages.map(message => message.text)].join('\n')
    expect(stored).not.toContain('sk-proj-abcdefghijklmnopqrstuvwx')
    expect(stored).not.toContain('deadbeefcafe0123')
    expect(stored).toContain('[REDACTED:api-key]')
  })
})
