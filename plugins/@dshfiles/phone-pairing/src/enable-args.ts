import { Schema } from 'effect'
import { providers } from './providers.ts'

/** The `phone_pairing_enable` tool runs outside Effect, so its arguments decode synchronously at that edge. */
export const decodeEnableArgs = Schema.decodeUnknownSync(
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literals(providers)),
    /** A gateway port to use instead of a busy `gatewayPort`; remembered in settings.json. */
    port: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65_535 }))),
  }),
)
