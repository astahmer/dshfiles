import { describe, expect, it } from 'vitest'
import { ThreadError } from './threads.js'
import type { ThreadLocation } from './threads.js'
import { locateOrMissing } from './workspace-location.js'

const location: ThreadLocation = { repoRoot: '/repo', workspaceRoot: '/repo', threadName: undefined }

describe('locateOrMissing', () => {
  it('treats only a non-repository path as missing and surfaces lookup failures', async () => {
    await expect(locateOrMissing(async () => location)).resolves.toEqual(location)
    await expect(
      locateOrMissing(async () => {
        throw new ThreadError('not-a-repository', 'outside jj')
      }),
    ).resolves.toBeUndefined()
    await expect(
      locateOrMissing(async () => {
        throw new Error('jj lookup timed out')
      }),
    ).rejects.toThrow('jj lookup timed out')
  })
})
