/**
 * Browser APIs that exist only in a secure context. A DSH page opened over plain HTTP from another device (a LAN or
 * tailnet address such as `http://192.168.1.44:3080`) is not one, so an unguarded call throws there and takes the slot
 * that ran it down, while `localhost` keeps working and hides the bug.
 */
const SECURE_CONTEXT_CALLS = [
  { api: 'crypto.randomUUID', call: /\bcrypto\??\.randomUUID\s*\(/g, replacement: 'randomUUID from @deepseek-ai/dsh-util-crypto' },
] as const

/** A feature check close before the call: `typeof crypto.randomUUID === 'function'` or `'randomUUID' in crypto`. */
const FEATURE_CHECK = /typeof\s+[\w$.?]*crypto\??\.randomUUID\b|["'`]randomUUID["'`]\s*in\s/

const GUARD_WINDOW = 160

interface SecureContextCall {
  readonly api: string
  readonly replacement: string
  readonly excerpt: string
}

/** Every unguarded call to a secure-context-only API in emitted client code. */
const unguardedCalls = (code: string): readonly SecureContextCall[] =>
  SECURE_CONTEXT_CALLS.flatMap(entry =>
    [...code.matchAll(entry.call)]
      .filter(match => !FEATURE_CHECK.test(code.slice(Math.max(0, match.index - GUARD_WINDOW), match.index)))
      .map(match => ({ api: entry.api, replacement: entry.replacement, excerpt: code.slice(Math.max(0, match.index - 40), match.index + 30) })),
  )

export const SecureContextCalls = { unguardedCalls } as const
