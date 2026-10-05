import { describe, expect, test } from 'vitest'
import { readRuntimeLaunch, type RuntimeLaunchJournal } from '../src/connectors/ssh-journal.js'

describe('SSH runtime launch journal lookup', () => {
  test('falls back to the system journal filtered to the user unit', async () => {
    const queried: RuntimeLaunchJournal[] = []
    const launch = await readRuntimeLaunch({
      readJournal: async source => {
        queried.push(source)
        return source === 'user-unit' ? 'Started DSH http://127.0.0.1:3282/?token=acceptance-token-123' : ''
      },
    })

    expect(launch).toEqual({ port: 3282, token: 'acceptance-token-123' })
    expect(queried).toEqual(['user', 'user-unit'])
  })

  test('does not query the system journal when the user journal has a launch URL', async () => {
    const queried: RuntimeLaunchJournal[] = []
    const launch = await readRuntimeLaunch({
      readJournal: async source => {
        queried.push(source)
        return source === 'user' ? 'Started DSH http://127.0.0.1:3199/?token=user-journal-token-123' : ''
      },
    })

    expect(launch).toEqual({ port: 3199, token: 'user-journal-token-123' })
    expect(queried).toEqual(['user'])
  })
})
