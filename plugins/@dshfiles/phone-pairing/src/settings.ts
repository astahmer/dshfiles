import { decodeJson, jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'
import { Effect, FileSystem, Option } from 'effect'

export type Provider = 'tailscale-funnel' | 'tailscale-serve' | 'cloudflared' | 'manual'

export interface PhoneSettings {
  readonly enabled: boolean
  /** Omitted means "pick the best available": Tailscale first, then a public tunnel. */
  readonly provider?: Provider
  /** Public origin for the manual provider, set by the user. */
  readonly origin?: string
}

const DEFAULT: PhoneSettings = { enabled: false }

const isProvider = (value: unknown): value is Provider =>
  value === 'tailscale-funnel' || value === 'tailscale-serve' || value === 'cloudflared' || value === 'manual'

const settingsOf = (parsed: JsonValue): PhoneSettings => {
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('enabled' in parsed) ||
    typeof parsed.enabled !== 'boolean' ||
    !('provider' in parsed) ||
    !isProvider(parsed.provider)
  )
    return DEFAULT
  const origin = 'origin' in parsed && typeof parsed.origin === 'string' && URL.canParse(parsed.origin) ? parsed.origin : undefined
  return origin === undefined ? { enabled: parsed.enabled, provider: parsed.provider } : { enabled: parsed.enabled, provider: parsed.provider, origin }
}

/**
 * The persistent opt-in: phone access is off until the user turns it on, and stays off across restarts. A missing,
 * unreadable or malformed file reads as off.
 */
export const loadPhoneSettings = Effect.fn('phone pairing settings load')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(path).pipe(Effect.option)
  if (Option.isNone(text)) return DEFAULT
  return yield* Effect.try(() => settingsOf(decodeJson(jsonValueSchema, text.value))).pipe(Effect.orElseSucceed(() => DEFAULT))
})

/** Persist the choice, readable by this user only. */
export const savePhoneSettings = Effect.fn('phone pairing settings save')(function* (path: string, next: PhoneSettings) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(path.slice(0, path.lastIndexOf('/')), { recursive: true, mode: 0o700 })
  yield* fs.writeFileString(path, JSON.stringify(next), { mode: 0o600 })
})
