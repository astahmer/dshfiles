import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { ScheduleRecord } from '@deepseek-ai/dsh-schedule/client'
import { describe, expect, it } from 'vitest'
import { createCatalogSource } from '../src/native/catalog-source.ts'

const fixture = () => {
  let revision = 0
  let reads = 0
  const changed = new Set<() => void>()
  const source = createCatalogSource({
    list: async (): Promise<RemoteResult<ScheduleRecord[]>> => {
      reads += 1
      return { ok: true, value: [] }
    },
    remove: async id => ({ ok: true, value: { id, deleted: true } }),
    subscribeChanged: listener => {
      changed.add(listener)
      return () => {
        changed.delete(listener)
      }
    },
    subscribeReset: () => () => {},
    revision: () => revision,
  })
  const mount = async (): Promise<() => void> => {
    const unsubscribe = source.hooks.catalog.subscribe(() => {})
    await Promise.resolve()
    await Promise.resolve()
    return unsubscribe
  }
  const scheduleChanged = (): void => {
    revision += 1
    for (const listener of changed) listener()
  }
  return { source, mount, scheduleChanged, reads: () => reads }
}

describe('a catalog subscribed again', () => {
  it('keeps its last read while no schedule change or reset happened since', async () => {
    const f = fixture()
    ;(await f.mount())()
    ;(await f.mount())()
    expect(f.reads()).toBe(1)
    expect(f.source.hooks.catalog.getSnapshot()).toMatchObject({ status: 'ready', settled: true })
  })

  it('reads again after a change it missed while nothing subscribed', async () => {
    const f = fixture()
    ;(await f.mount())()
    f.scheduleChanged()
    ;(await f.mount())()
    expect(f.reads()).toBe(2)
  })

  it('still rereads on a change while subscribed', async () => {
    const f = fixture()
    const unsubscribe = await f.mount()
    f.scheduleChanged()
    await Promise.resolve()
    expect(f.reads()).toBe(2)
    unsubscribe()
    ;(await f.mount())()
    expect(f.reads()).toBe(2)
  })
})
