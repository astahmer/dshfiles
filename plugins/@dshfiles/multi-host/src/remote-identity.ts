import { Effect, Path, Schema } from 'effect'
import type { Gateway } from './connectors/gateway.js'
import { IdentityInvalid, IdentityMismatch, IdentityUnavailable, RuntimeCapabilityMissing, RuntimeIncompatible } from './errors.js'
import { runtimeIdentitySchema, type RuntimeIdentity, type RuntimeRecord } from './records.js'

const requiredCapabilities: readonly RuntimeIdentity['capabilities'][number][] = ['workspace', 'session', 'agent']
const decodeIdentity = Schema.decodeUnknownEffect(runtimeIdentitySchema)

/** The identity a connected runtime reports through its own multi-host API, checked for a supported DSH 0.2. */
const read = Effect.fn('multi-host remote identity read')(function* (gateway: Gateway) {
  const raw = yield* gateway.api('identity').pipe(Effect.mapError(cause => new IdentityUnavailable({ cause })))
  const identity = yield* decodeIdentity(raw).pipe(Effect.mapError(() => new IdentityInvalid()))
  if (identity.protocolVersion !== 1 || identity.dshVersion === 'unknown' || !identity.dshVersion.startsWith('0.2.')) return yield* new RuntimeIncompatible()
  if (!requiredCapabilities.every(capability => identity.capabilities.includes(capability))) return yield* new RuntimeCapabilityMissing()
  return identity
})

/** The connected runtime must still be the one pinned at registration, in the SSH home it was registered with. */
const verifyPinned = Effect.fn('multi-host remote identity verify')(function* (input: { readonly gateway: Gateway; readonly runtime: RuntimeRecord }) {
  const path = yield* Path.Path
  const current = yield* read(input.gateway)
  const pinned = input.runtime.identity
  if (pinned === null) return yield* new IdentityMismatch({ reason: 'unpinned' })
  if (
    current.runtimeId !== input.runtime.id ||
    current.runtimeId !== pinned.runtimeId ||
    current.profile !== pinned.profile ||
    current.homeLeaf !== pinned.homeLeaf ||
    current.protocolVersion !== pinned.protocolVersion
  ) {
    return yield* new IdentityMismatch({ reason: 'changed' })
  }
  if (input.runtime.locator.kind === 'ssh' && current.homeLeaf !== path.basename(input.runtime.locator.remoteHome)) {
    return yield* new IdentityMismatch({ reason: 'home' })
  }
  return current
})

export class RemoteIdentity {
  static readonly read = read
  static readonly verifyPinned = verifyPinned
}
