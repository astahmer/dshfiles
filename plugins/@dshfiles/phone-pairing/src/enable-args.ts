import { Schema } from 'effect'
import { providers } from './providers.ts'

/** The `phone_pairing_enable` tool runs outside Effect, so its arguments decode synchronously at that edge. */
export const decodeEnableArgs = Schema.decodeUnknownSync(Schema.Struct({ provider: Schema.optionalKey(Schema.Literals(providers)) }))
