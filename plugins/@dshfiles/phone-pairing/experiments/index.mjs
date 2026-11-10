import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const token = () => randomBytes(32).toString('base64url')
const hash = value => createHash('sha256').update(value).digest('hex')
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
const matches = (value, digest) =>
  validToken(value) &&
  typeof digest === 'string' &&
  /^[a-f0-9]{64}$/.test(digest) &&
  timingSafeEqual(Buffer.from(hash(value), 'hex'), Buffer.from(digest, 'hex'))

const CLAIM_DOMAIN = 'dsh-pairing-claim-v1:'

/** The phone generates a private claim secret and publishes only this commitment. */
export const newClaimSecret = () => token()

export const claimCommitment = claimSecret => hash(`${CLAIM_DOMAIN}${claimSecret}`)

const claimMatches = (claimSecret, commitment) =>
  validToken(claimSecret) &&
  typeof commitment === 'string' &&
  /^[a-f0-9]{64}$/.test(commitment) &&
  timingSafeEqual(Buffer.from(claimCommitment(claimSecret), 'hex'), Buffer.from(commitment, 'hex'))
const syncDirectory = async path => {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Standalone, single-owner pairing core. Never expose this object as an agent tool. */
export const createPairingCore = async ({
  path,
  enrollmentTtlMs = 120_000,
  sessionTtlMs = 3_600_000,
  credentialTtlMs = 365 * 24 * 3_600_000,
  maxEnrollments = 100,
  maxSessions = 1000,
  now = Date.now,
  syncParentDirectory = syncDirectory,
}) => {
  if (
    !Number.isSafeInteger(enrollmentTtlMs) ||
    enrollmentTtlMs <= 0 ||
    !Number.isSafeInteger(sessionTtlMs) ||
    sessionTtlMs <= 0 ||
    !Number.isSafeInteger(credentialTtlMs) ||
    credentialTtlMs <= 0
  )
    throw new Error('Invalid lifetime')
  if (!Number.isSafeInteger(maxEnrollments) || maxEnrollments <= 0 || !Number.isSafeInteger(maxSessions) || maxSessions <= 0)
    throw new Error('Invalid capacity')
  let devices = []
  try {
    const state = JSON.parse(await readFile(path, 'utf8'))
    if (
      state.version !== 2 ||
      !Array.isArray(state.devices) ||
      !state.devices.every(
        device =>
          typeof device.id === 'string' &&
          /^[a-f0-9]{64}$/.test(device.credentialHash) &&
          typeof device.name === 'string' &&
          Number.isSafeInteger(device.createdAt) &&
          Number.isSafeInteger(device.expiresAt) &&
          device.expiresAt > device.createdAt,
      )
    )
      throw new Error('Invalid pairing state')
    devices = state.devices.map(({ id, name, credentialHash, createdAt, expiresAt }) => ({ id, name, credentialHash, createdAt, expiresAt }))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const enrollments = new Map()
  const sessions = new Map()
  let pending = Promise.resolve()
  let failed = false
  const ensureAvailable = () => {
    if (failed) throw new Error('Pairing storage unavailable; restart after resolving storage failure')
  }
  const serialize = operation => {
    const result = pending.then(operation)
    pending = result.catch(() => {})
    return result
  }
  const persist = async next => {
    const temporary = join(dirname(path), `.pairing-${token()}.tmp`)
    let handle
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(JSON.stringify({ version: 2, devices: next }))
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporary, path)
      await syncParentDirectory(dirname(path))
    } catch (error) {
      failed = true
      enrollments.clear()
      sessions.clear()
      throw error
    } finally {
      if (handle) await handle.close()
      await unlink(temporary).catch(error => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }
  const prune = () => {
    const time = now()
    for (const [id, entry] of enrollments) if (entry.expiresAt <= time) enrollments.delete(id)
    for (const [digest, entry] of sessions) if (entry.expiresAt <= time) sessions.delete(digest)
  }
  return {
    beginEnrollment: ({ name }) => {
      ensureAvailable()
      if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) throw new Error('Invalid device name')
      prune()
      if (enrollments.size >= maxEnrollments) throw new Error('Enrollment capacity reached')
      const id = token()
      const secret = token()
      const expiresAt = now() + enrollmentTtlMs
      enrollments.set(id, { name: name.trim(), secretHash: hash(secret), expiresAt, approved: false })
      return { id, secret, expiresAt }
    },
    pendingEnrollments: () => {
      prune()
      return [...enrollments].map(([id, entry]) => ({
        id,
        name: entry.name,
        expiresAt: entry.expiresAt,
        approved: entry.approved,
        commitment: entry.commitment ?? null,
      }))
    },
    claimEnrollment: ({ id, secret, commitment }) => {
      ensureAvailable()
      prune()
      const entry = enrollments.get(id)
      if (!entry || !matches(secret, entry.secretHash) || typeof commitment !== 'string' || !/^[a-f0-9]{64}$/.test(commitment)) return false
      if (entry.commitment) return entry.commitment === commitment
      entry.commitment = commitment
      return true
    },
    approveEnrollment: ({ id, commitment }) => {
      ensureAvailable()
      prune()
      const entry = enrollments.get(id)
      if (!entry || !entry.commitment || entry.commitment !== commitment) return false
      entry.approved = true
      return true
    },
    redeemEnrollment: ({ id, secret, claimSecret }) =>
      serialize(async () => {
        ensureAvailable()
        prune()
        const entry = enrollments.get(id)
        if (!entry || !entry.approved || !matches(secret, entry.secretHash) || !claimMatches(claimSecret, entry.commitment)) return null
        enrollments.delete(id)
        const credential = token()
        const createdAt = now()
        const expiresAt = createdAt + credentialTtlMs
        if (!Number.isSafeInteger(expiresAt)) throw new Error('Invalid credential expiry')
        const device = { id: token(), name: entry.name, credentialHash: hash(credential), createdAt, expiresAt }
        const next = [...devices, device]
        await persist(next)
        devices = next
        return { deviceId: device.id, credential }
      }),
    listDevices: () => devices.map(({ id, name, createdAt, expiresAt }) => ({ id, name, createdAt, expiresAt })),
    openSession: ({ deviceId, credential }) =>
      serialize(() => {
        ensureAvailable()
        prune()
        const device = devices.find(entry => entry.id === deviceId)
        if (!device || device.expiresAt <= now() || !matches(credential, device.credentialHash)) return null
        if (sessions.size >= maxSessions) throw new Error('Session capacity reached')
        const secret = token()
        const expiresAt = Math.min(now() + sessionTtlMs, device.expiresAt)
        sessions.set(hash(secret), { deviceId, expiresAt })
        return { secret, expiresAt }
      }),
    authenticateSession: ({ secret }) => {
      if (failed) return null
      prune()
      if (!validToken(secret)) return null
      const session = sessions.get(hash(secret))
      return session ? { deviceId: session.deviceId, expiresAt: session.expiresAt } : null
    },
    closeSession: ({ secret }) => validToken(secret) && sessions.delete(hash(secret)),
    revokeDevice: ({ deviceId }) =>
      serialize(async () => {
        ensureAvailable()
        const next = devices.filter(entry => entry.id !== deviceId)
        if (next.length === devices.length) return false
        devices = next
        for (const [digest, session] of sessions) if (session.deviceId === deviceId) sessions.delete(digest)
        await persist(next)
        return true
      }),
  }
}
