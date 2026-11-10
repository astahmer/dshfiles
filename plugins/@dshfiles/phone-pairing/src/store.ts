import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

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
  const sessions = new Map<string, SessionRecord>()
  let devices: DeviceRecord[] = []
  let budget = { windowStart: 0, count: 0 }

  const readDevices = async (): Promise<DeviceRecord[]> => {
    const { readFile } = await import('node:fs/promises')
    try {
      const parsed: unknown = JSON.parse(await readFile(options.path, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || parsed.version !== 1) throw new Error('Invalid pairing state')
      if (!('devices' in parsed) || !Array.isArray(parsed.devices)) throw new Error('Invalid pairing state')
      return parsed.devices.map(entry => {
        if (typeof entry !== 'object' || entry === null) throw new Error('Invalid pairing state')
        const { id, name, tokenDigest, createdAt, expiresAt, lastUsedAt } = entry as Record<string, unknown>
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

  const prune = (): void => {
    const time = now()
    for (const [id, offer] of offers) if (offer.expiresAt <= time) offers.delete(id)
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

  const findOffer = (input: { readonly id?: string; readonly secret?: string; readonly code?: string }): [string, OfferRecord] | undefined => {
    if (input.id !== undefined) {
      const offer = offers.get(input.id)
      if (offer === undefined) return undefined
      if (input.secret !== undefined && TOKEN_PATTERN.test(input.secret) && sameDigest(input.secret, offer.secretDigest)) return [input.id, offer]
      if (input.code !== undefined && CODE_PATTERN.test(input.code) && sameDigest(input.code, offer.codeDigest)) return [input.id, offer]
      return undefined
    }
    if (input.code === undefined || !CODE_PATTERN.test(input.code)) return undefined
    for (const [id, offer] of offers) if (sameDigest(input.code, offer.codeDigest)) return [id, offer]
    return undefined
  }

  return {
    beginOffer: (): PairingOffer => {
      prune()
      if (offers.size >= maxOffers) throw new Error('Too many pending pairing offers')
      const id = token()
      const secret = token()
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
      const expiresAt = now() + offerTtlMs
      offers.set(id, { secretDigest: digest(secret), codeDigest: digest(code), expiresAt, attempts: 0 })
      return { id, secret, code, expiresAt }
    },

    /** One single-use redemption: scanned secret or typed code in, device token out. */
    redeem: async (input: {
      readonly id?: string
      readonly secret?: string
      readonly code?: string
      readonly name?: string
    }): Promise<{ deviceId: string; token: string } | undefined> => {
      prune()
      if (!spendBudget()) return undefined
      const match = findOffer(input)
      if (match === undefined) return undefined
      const [id, offer] = match
      offer.attempts += 1
      offers.delete(id)
      if (devices.length >= maxDevices) throw new Error('Too many paired devices')
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
      return { deviceId: device.id, token: credential }
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
