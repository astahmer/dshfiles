import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { Effect, Schema } from 'effect'
import { PASSPHRASE_MAX, type ExpiryPreset } from './share-policy-constants.js'

/** Every share link starts with this, so the redactor and a reader can both recognise one. */
const TOKEN_PREFIX = 'dshs_'

export const TOKEN_PATTERN = /^dshs_[\w-]{43}$/

const EXPIRY_MS = {
  '1h': 3_600_000,
  '1d': 86_400_000,
  '7d': 7 * 86_400_000,
} as const satisfies Record<Exclude<ExpiryPreset, 'never'>, number>

export type ShareStatus = 'active' | 'expired' | 'revoked'

/** scrypt cost parameters: N=2^15 takes tens of milliseconds, which caps an online guesser per CPU core. */
const SCRYPT = { N: 32_768, r: 8, p: 1, keyLength: 32, maxmem: 64 * 1024 * 1024 } as const

export const passphraseHashSchema = Schema.Struct({
  algorithm: Schema.Literal('scrypt'),
  N: Schema.Number.check(Schema.isInt()),
  r: Schema.Number.check(Schema.isInt()),
  p: Schema.Number.check(Schema.isInt()),
  salt: Schema.String.check(Schema.isPattern(/^[\w-]{22}$/)),
  hash: Schema.String.check(Schema.isPattern(/^[\w-]{43}$/)),
})
export type PassphraseHash = typeof passphraseHashSchema.Type

/** The passphrase could not be hashed (out of memory for scrypt, or a crypto failure). */
export class PassphraseHashFailed extends Schema.TaggedError<PassphraseHashFailed>()(
  'PassphraseHashFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-share-passphrase-hash-failed' },
) {
  override get message(): string {
    return 'The passphrase could not be hashed. Try again; if it keeps failing, create the share with link-only access.'
  }
}

const derive = (input: { readonly passphrase: string; readonly salt: Buffer; readonly N: number; readonly r: number; readonly p: number }) =>
  Effect.callback<Buffer, PassphraseHashFailed>(resume => {
    scrypt(input.passphrase.normalize('NFKC'), input.salt, SCRYPT.keyLength, { N: input.N, r: input.r, p: input.p, maxmem: SCRYPT.maxmem }, (error, key) => {
      resume(error === null ? Effect.succeed(key) : Effect.fail(new PassphraseHashFailed({ cause: error })))
    })
  })

/** Link tokens, passphrase hashes and expiry: the security decisions of a share, free of storage and HTTP. */
export class SharePolicy {
  /** 32 random bytes: a 256-bit link secret, base64url so it sits in a URL path unescaped. */
  static generateToken(): string {
    return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  }

  /** Only this digest of the link token is stored; the link itself leaves the Host once, when the share is created. */
  static tokenDigest(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex')
  }

  /** A short opaque id the list and revoke use; never derived from the token. */
  static generateShareId(): string {
    return randomBytes(9).toString('base64url')
  }

  static expiresAt(input: { readonly preset: ExpiryPreset; readonly now: number }): number | null {
    return input.preset === 'never' ? null : input.now + EXPIRY_MS[input.preset]
  }

  static status(input: { readonly revokedAt: number | null; readonly expiresAt: number | null; readonly now: number }): ShareStatus {
    if (input.revokedAt !== null) return 'revoked'
    if (input.expiresAt !== null && input.now >= input.expiresAt) return 'expired'
    return 'active'
  }

  /** A fresh random salt per share; only the salt and the derived key are kept, never the passphrase. */
  static readonly hashPassphrase = Effect.fn('thread share passphrase hash')(function* (passphrase: string) {
    const salt = randomBytes(16)
    const key = yield* derive({ passphrase, salt, N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
    const stored: PassphraseHash = {
      algorithm: 'scrypt',
      N: SCRYPT.N,
      r: SCRYPT.r,
      p: SCRYPT.p,
      salt: salt.toString('base64url'),
      hash: key.toString('base64url'),
    }
    return stored
  })

  /** Constant-time comparison of the derived key; a wrong passphrase and a malformed one take the same path. */
  static readonly verifyPassphrase = Effect.fn('thread share passphrase verify')(function* (input: {
    readonly stored: PassphraseHash
    readonly presented: string
  }) {
    if (input.presented.length === 0 || input.presented.length > PASSPHRASE_MAX) return false
    const expected = Buffer.from(input.stored.hash, 'base64url')
    const key = yield* derive({
      passphrase: input.presented,
      salt: Buffer.from(input.stored.salt, 'base64url'),
      N: input.stored.N,
      r: input.stored.r,
      p: input.stored.p,
    })
    return key.length === expected.length && timingSafeEqual(key, expected)
  })
}
