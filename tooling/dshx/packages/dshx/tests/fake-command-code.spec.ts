import { describe, expect, it } from 'vitest'
import { startFakeCommandCode } from '../src/scratch/fake-command-code.js'

describe('fake Command Code provider', () => {
  it('uses the user directive before appended runtime snapshots', async () => {
    const fake = await startFakeCommandCode()
    try {
      const response = await fetch(`${fake.baseUrl}/provider/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: 'Bearer TEST-ALPHA1', 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'developer', content: 'Assistant instructions' },
            { role: 'user', content: '[[answer Trunk is `jj:main` here]]' },
            { role: 'user', content: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.' },
            { role: 'user', content: 'Time sampled while preparing turn 1, step 1: timestamp and zone.' },
          ],
        }),
      })

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('Trunk is `jj:main` here')
    } finally {
      await fake.close()
    }
  })
})
