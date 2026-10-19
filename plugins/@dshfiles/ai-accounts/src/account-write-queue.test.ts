import { describe, expect, it } from 'vitest'
import { AccountWriteQueue } from './account-write-queue.js'

describe('account write queue', () => {
  it('starts each write after the previous one settles, failed or not, in call order', async () => {
    const enqueue = AccountWriteQueue.create()
    const events: string[] = []
    let releaseRename = (): void => undefined
    const rename = enqueue(
      () =>
        new Promise<void>((_resolve, reject) => {
          events.push('rename started')
          releaseRename = () => {
            events.push('rename settled')
            reject(new Error('refused'))
          }
        }),
    )
    const keySave = enqueue(async () => {
      events.push('key save started')
      return 'saved'
    })
    await Promise.resolve()
    expect(events).toEqual(['rename started'])
    releaseRename()
    await expect(rename).rejects.toThrow('refused')
    await expect(keySave).resolves.toBe('saved')
    expect(events).toEqual(['rename started', 'rename settled', 'key save started'])
  })
})
