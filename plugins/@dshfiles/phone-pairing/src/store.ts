import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { decodeJson, jsonValueSchema } from '@dshfiles/dshx/json'

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const CODE_PATTERN = /^\d{6}$/
const DIGEST_PATTERN = /^[a-f0-9]{64}$/

const token = (): string => randomBytes(32).toString('base64url')
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

const sameDigest = (value: string, stored: string): boolean => timingSafeEqual(Buffer.from(digest(value), 'hex'), Buffer.from(stored, 'hex'))

export interface PairingOffer {
  /** Fragments and codes die with the offer. */
  readonly id: string
  readonly secret: string
  readonly code: string
  readonly expiresAt: number
}

export interface PairingDevice {
  readonly id: string
  readonly name: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly lastUsedAt: number
}

export interface PairingStoreOptions {
  /** Absolute path of the device file; its directory must already exist and be private. */
  readonly path: string
  readonly now?: () => number
  readonly offerTtlMs?: number
  readonly sessionTtlMs?: number
  readonly deviceTtlMs?: number
  readonly maxOffers?: number
  readonly maxSessions?: number
  readonly maxDevices?: number
  readonly redeemsPerMinute?: number
}

interface OfferRecord {
  readonly secretDigest: string
  readonly codeDigest: string
  readonly expiresAt: number
  attempts: number
}

/** Why a code no longer pairs: the phone page says which, so a refused code is never a guess. */
export type RedeemRefusal = 'used' | 'expired' | 'replaced' | 'wrong' | 'rate-limited' | 'device-limit'

export type RedeemResult = { readonly ok: true; readonly deviceId: string; readonly token: string } | { readonly ok: false; readonly reason: RedeemRefusal }

/** A spent, expired or replaced offer, kept a while so a second try with its code is told why it fails. */
interface RetiredOffer {
  readonly secretDigest: string
  readonly codeDigest: string
  readonly reason: 'used' | 'expired' | 'replaced'
  readonly until: number
}

const RETIRED_LIMIT = 32

interface DeviceRecord {
  readonly id: string
  readonly name: string
  readonly tokenDigest: string
  readonly createdAt: number
  readonly expiresAt: number
  lastUsedAt: number
}

interface SessionRecord {
  readonly deviceId: string
  readonly expiresAt: number
}

/**
 * One-time pairing offers live in memory; device credentials persist as hashes only.
 * The cookie carries the bearer token, the file carries its digest.
 */
export const createPairingStore = async (options: PairingStoreOptions) => {
  const now = options.now ?? Date.now
  const offerTtlMs = options.offerTtlMs ?? 5 * 60_000
  const sessionTtlMs = options.sessionTtlMs ?? 30 * 24 * 3_600_000
  const deviceTtlMs = options.deviceTtlMs ?? 365 * 24 * 3_600_000
  const maxOffers = options.maxOffers ?? 8
  const maxSessions = options.maxSessions ?? 200
  const maxDevices = options.maxDevices ?? 20
  const redeemsPerMinute = options.redeemsPerMinute ?? 20

  const offers = new Map<string, OfferRecord>()
  const retired = new Map<string, RetiredOffer>()
  const sessions = new Map<string, SessionRecord>()
  let devices: DeviceRecord[] = []
  let budget = { windowStart: 0, count: 0 }

  const readDevices = async (): Promise<DeviceRecord[]> => {
    const { readFile } = await import('node:fs/promises')
    try {
      const parsed = decodeJson(jsonValueSchema, await readFile(options.path, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || parsed.version !== 1) throw new Error('Invalid pairing state')
      if (!('devices' in parsed) || !Array.isArray(parsed.devices)) throw new Error('Invalid pairing state')
      return parsed.devices.map(entry => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error('Invalid pairing state')
        const { id, name, tokenDigest, createdAt, expiresAt, lastUsedAt } = entry
        if (
          typeof id !== 'string' ||
          typeof name !== 'string' ||
          typeof tokenDigest !== 'string' ||
          !DIGEST_PATTERN.test(tokenDigest) ||
          typeof createdAt !== 'number' ||
          typeof expiresAt !== 'number' ||
          typeof lastUsedAt !== 'number'
        )
          throw new Error('Invalid pairing state')
        return { id, name, tokenDigest, createdAt, expiresAt, lastUsedAt }
      })
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
  }

  const writeDevices = async (next: readonly DeviceRecord[]): Promise<void> => {
    const { open, rename } = await import('node:fs/promises')
    const temporary = `${options.path}.${token()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify({ version: 1, devices: next }))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, options.path)
  }

  devices = await readDevices()

  const retire = (id: string, offer: OfferRecord, reason: RetiredOffer['reason']): void => {
    offers.delete(id)
    retired.delete(id)
    retired.set(id, { secretDigest: offer.secretDigest, codeDigest: offer.codeDigest, reason, until: now() + offerTtlMs })
    for (const oldest of retired.keys()) {
      if (retired.size <= RETIRED_LIMIT) break
      retired.delete(oldest)
    }
  }

  const prune = (): void => {
    const time = now()
    for (const [id, offer] of offers) if (offer.expiresAt <= time) retire(id, offer, 'expired')
    for (const [id, offer] of retired) if (offer.until <= time) retired.delete(id)
    for (const [credential, session] of sessions) if (session.expiresAt <= time) sessions.delete(credential)
    devices = devices.filter(device => device.expiresAt > time)
  }

  const spendBudget = (): boolean => {
    const time = now()
    if (time - budget.windowStart >= 60_000) budget = { windowStart: time, count: 0 }
    if (budget.count >= redeemsPerMinute) return false
    budget.count += 1
    return true
  }

  /** Whether the scanned secret or typed code belongs to this offer (pending or retired). */
  const matches = (
    input: { readonly secret?: string; readonly code?: string },
    offer: { readonly secretDigest: string; readonly codeDigest: string },
  ): boolean =>
    (input.secret !== undefined && TOKEN_PATTERN.test(input.secret) && sameDigest(input.secret, offer.secretDigest)) ||
    (input.code !== undefined && CODE_PATTERN.test(input.code) && sameDigest(input.code, offer.codeDigest))

  const findOffer = <T extends { readonly secretDigest: string; readonly codeDigest: string }>(
    from: ReadonlyMap<string, T>,
    input: { readonly id?: string; readonly secret?: string; readonly code?: string },
  ): [string, T] | undefined => {
    if (input.id !== undefined) {
      const offer = from.get(input.id)
      return offer !== undefined && matches(input, offer) ? [input.id, offer] : undefined
    }
    if (input.code === undefined || !CODE_PATTERN.test(input.code)) return undefined
    for (const [id, offer] of from) if (matches({ code: input.code }, offer)) return [id, offer]
    return undefined
  }

  const attempt = async (input: { readonly id?: string; readonly secret?: string; readonly code?: string; readonly name?: string }): Promise<RedeemResult> => {
    prune()
    if (!spendBudget()) return { ok: false, reason: 'rate-limited' }
    const match = findOffer(offers, input)
    if (match === undefined) return { ok: false, reason: findOffer(retired, input)?.[1].reason ?? 'wrong' }
    const [id, offer] = match
    if (devices.length >= maxDevices) return { ok: false, reason: 'device-limit' }
    offer.attempts += 1
    retire(id, offer, 'used')
    const credential = token()
    const createdAt = now()
    const device: DeviceRecord = {
      id: token(),
      name: (input.name ?? 'Phone').slice(0, 60),
      tokenDigest: digest(credential),
      createdAt,
      expiresAt: createdAt + deviceTtlMs,
      lastUsedAt: createdAt,
    }
    const next = [...devices, device]
    await writeDevices(next)
    devices = next
    return { ok: true, deviceId: device.id, token: credential }
  }

  return {
    /**
     * A new offer replaces the oldest pending one once `maxOffers` are open: the bound on guessable codes
     * stays, and asking for a code never fails because earlier ones were never used.
     */
    beginOffer: (): PairingOffer => {
      prune()
      for (const [id, offer] of offers) {
        if (offers.size < maxOffers) break
        retire(id, offer, 'replaced')
      }
      const id = token()
      const secret = token()
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
      const expiresAt = now() + offerTtlMs
      offers.set(id, { secretDigest: digest(secret), codeDigest: digest(code), expiresAt, attempts: 0 })
      return { id, secret, code, expiresAt }
    },

    /** One single-use redemption with the reason it was refused: used, expired, replaced, wrong, rate-limited or full. */
    attempt,

    /** One single-use redemption: scanned secret or typed code in, device token out. */
    redeem: async (input: {
      readonly id?: string
      readonly secret?: string
      readonly code?: string
      readonly name?: string
    }): Promise<{ deviceId: string; token: string } | undefined> => {
      const result = await attempt(input)
      return result.ok ? { deviceId: result.deviceId, token: result.token } : undefined
    },

    authenticate: (credential: string): { deviceId: string; expiresAt: number } | undefined => {
      prune()
      if (!TOKEN_PATTERN.test(credential)) return undefined
      const device = devices.find(entry => sameDigest(credential, entry.tokenDigest))
      if (device === undefined) return undefined
      device.lastUsedAt = now()
      const existing = sessions.get(credential)
      if (existing !== undefined && existing.expiresAt > now()) return existing
      if (sessions.size >= maxSessions) sessions.clear()
      const session = { deviceId: device.id, expiresAt: Math.min(now() + sessionTtlMs, device.expiresAt) }
      sessions.set(credential, session)
      return session
    },

    deviceOf: (credential: string): PairingDevice | undefined => {
      prune()
      const device = devices.find(entry => sameDigest(credential, entry.tokenDigest))
      return device === undefined
        ? undefined
        : { id: device.id, name: device.name, createdAt: device.createdAt, expiresAt: device.expiresAt, lastUsedAt: device.lastUsedAt }
    },

    listDevices: (): PairingDevice[] => {
      prune()
      return devices.map(({ id, name, createdAt, expiresAt, lastUsedAt }) => ({ id, name, createdAt, expiresAt, lastUsedAt }))
    },

    pendingOffers: (): number => {
      prune()
      return offers.size
    },

    revoke: async (deviceId: string): Promise<boolean> => {
      const next = devices.filter(device => device.id !== deviceId)
      if (next.length === devices.length) return false
      devices = next
      for (const [credential, session] of sessions) if (session.deviceId === deviceId) sessions.delete(credential)
      await writeDevices(next)
      return true
    },
  }
}

export type PairingStore = Awaited<ReturnType<typeof createPairingStore>>
