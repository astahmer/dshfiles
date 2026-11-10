import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPairingStore } from '../src/store.ts'

const fixture = async (run: (path: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), 'pairing-store-'))
  try {
    await run(join(directory, 'devices.json'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('pairing store', () => {
  it('redeems an offer once and authenticates the stored device afterwards', async () =>
    await fixture(async path => {
      let time = 1_000
      const store = await createPairingStore({ path, now: () => time, offerTtlMs: 60_000 })
      const offer = store.beginOffer()
      const paired = await store.redeem({ id: offer.id, secret: offer.secret })
      expect(paired).toBeDefined()
      expect(await store.redeem({ id: offer.id, secret: offer.secret })).toBeUndefined()
      expect(store.authenticate(paired?.token ?? '')).toMatchObject({ deviceId: paired?.deviceId })
      expect(store.authenticate('nope')).toBeUndefined()
      const stored = await readFile(path, 'utf8')
      expect(stored).not.toContain(paired?.token ?? '')
      expect(store.listDevices()).toHaveLength(1)
    }))

  it('expires offers and enforces the failure budget', async () =>
    await fixture(async path => {
      let time = 1_000
      const store = await createPairingStore({ path, now: () => time, offerTtlMs: 120_000, redeemsPerMinute: 1 })
      const offer = store.beginOffer()
      expect(await store.redeem({ id: offer.id, secret: 'wrong' })).toBeUndefined()
      expect(await store.redeem({ id: offer.id, secret: offer.secret })).toBeUndefined()
      time += 60_000
      expect(await store.redeem({ id: offer.id, secret: offer.secret })).toMatchObject({ deviceId: expect.any(String) })
      time += 120_000
      const expired = store.beginOffer()
      time += 120_000
      expect(await store.redeem({ id: expired.id, code: expired.code })).toBeUndefined()
    }))

  it('accepts the typed code without scanning', async () =>
    await fixture(async path => {
      const store = await createPairingStore({ path })
      const offer = store.beginOffer()
      expect(await store.redeem({ code: offer.code })).toMatchObject({ deviceId: expect.any(String) })
      expect(store.listDevices()).toHaveLength(1)
    }))

  it('revokes a device and survives a restart', async () =>
    await fixture(async path => {
      const store = await createPairingStore({ path })
      const offer = store.beginOffer()
      const paired = await store.redeem({ id: offer.id, secret: offer.secret })
      const deviceId = paired?.deviceId ?? ''
      const reloaded = await createPairingStore({ path })
      expect(reloaded.authenticate(paired?.token ?? '')).toBeDefined()
      expect(await reloaded.revoke(deviceId)).toBe(true)
      expect((await createPairingStore({ path })).listDevices()).toEqual([])
      expect(await reloaded.revoke(deviceId)).toBe(false)
    }))
})
