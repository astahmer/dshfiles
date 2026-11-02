import { Schema, SchemaAST } from 'effect'

export class SshTargetInvalid extends Schema.TaggedError<SshTargetInvalid>()('SshTargetInvalid', {}, { dshxWireCode: 'invalid-ssh-target' }) {
  override get message(): string {
    return 'The SSH target is invalid.'
  }
}

export class SshUnavailable extends Schema.TaggedError<SshUnavailable>()(
  'SshUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'ssh-unavailable' },
) {
  override get message(): string {
    return 'The ssh executable could not be started.'
  }
}

export class SshInputTooLarge extends Schema.TaggedError<SshInputTooLarge>()(
  'SshInputTooLarge',
  { bytes: Schema.Number, limit: Schema.Number },
  { dshxWireCode: 'ssh-input-too-large' },
) {
  override get message(): string {
    return 'The SSH input exceeded its limit.'
  }
}

export class SshOutputTooLarge extends Schema.TaggedError<SshOutputTooLarge>()(
  'SshOutputTooLarge',
  { limit: Schema.Number },
  { dshxWireCode: 'ssh-output-too-large' },
) {
  override get message(): string {
    return 'The SSH command returned more data than allowed.'
  }
}

export class SshTimedOut extends Schema.TaggedError<SshTimedOut>()('SshTimedOut', { timeoutMs: Schema.Number }, { dshxWireCode: 'ssh-timeout' }) {
  override get message(): string {
    return 'The SSH command exceeded its time limit.'
  }
}

export class SshHostKeyRejected extends Schema.TaggedError<SshHostKeyRejected>()('SshHostKeyRejected', {}, { dshxWireCode: 'host-key-rejected' }) {
  override get message(): string {
    return 'SSH host identity is unknown or changed; verify it in known_hosts before connecting.'
  }
}

export class SshAuthenticationFailed extends Schema.TaggedError<SshAuthenticationFailed>()(
  'SshAuthenticationFailed',
  {},
  { dshxWireCode: 'ssh-authentication-failed' },
) {
  override get message(): string {
    return 'SSH authentication failed in BatchMode; configure a key for this host first.'
  }
}

export class SshHostUnresolved extends Schema.TaggedError<SshHostUnresolved>()('SshHostUnresolved', {}, { dshxWireCode: 'ssh-host-unresolved' }) {
  override get message(): string {
    return 'The SSH target could not be resolved.'
  }
}

export class SshUnreachable extends Schema.TaggedError<SshUnreachable>()('SshUnreachable', {}, { dshxWireCode: 'ssh-unreachable' }) {
  override get message(): string {
    return 'The SSH target is unreachable.'
  }
}

export class SshCommandFailed extends Schema.TaggedError<SshCommandFailed>()(
  'SshCommandFailed',
  { exitCode: Schema.NullOr(Schema.Number), stderrTail: Schema.optional(Schema.String.check(Schema.isMaxLength(8_192))) },
  { dshxWireCode: 'ssh-command-failed' },
) {
  override get message(): string {
    return this.stderrTail?.trim() || 'The SSH command failed.'
  }
}

export class TunnelFailed extends Schema.TaggedError<TunnelFailed>()('TunnelFailed', {}, { dshxWireCode: 'tunnel-failed' }) {
  override get message(): string {
    return 'The SSH forwarding process exited before its loopback endpoint became ready.'
  }
}

export class TunnelTimedOut extends Schema.TaggedError<TunnelTimedOut>()('TunnelTimedOut', { timeoutMs: Schema.Number }, { dshxWireCode: 'tunnel-timeout' }) {
  override get message(): string {
    return 'The SSH loopback forward did not become ready before its time limit.'
  }
}

export class RuntimeNotRunning extends Schema.TaggedError<RuntimeNotRunning>()(
  'RuntimeNotRunning',
  { reason: Schema.Literals(['no-launch-file', 'closed-port']) },
  { dshxWireCode: 'runtime-not-running' },
) {
  override get message(): string {
    if (this.reason === 'closed-port') return 'DSH is not running on this host: its launch file points at a closed port. Start DSH there and reconnect.'
    return 'No launch file was found in the remote DSH home. Start DSH there with the multi-host plugin, or through dsh-web, and try again.'
  }
}

export class DirectoryPathInvalid extends Schema.TaggedError<DirectoryPathInvalid>()('DirectoryPathInvalid', {}, { dshxWireCode: 'directory-path-invalid' }) {
  override get message(): string {
    return 'The multi-host data directory or its directory file is not a private regular path.'
  }
}

export class DirectoryUnreadable extends Schema.TaggedError<DirectoryUnreadable>()(
  'DirectoryUnreadable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'directory-unreadable' },
) {
  override get message(): string {
    return 'The multi-host directory could not be read.'
  }
}

export class DirectoryCorrupt extends Schema.TaggedError<DirectoryCorrupt>()('DirectoryCorrupt', {}, { dshxWireCode: 'directory-corrupt' }) {
  override get message(): string {
    return 'The multi-host directory contains invalid JSON and was left untouched.'
  }
}

export class DirectoryVersionUnsupported extends Schema.TaggedError<DirectoryVersionUnsupported>()(
  'DirectoryVersionUnsupported',
  {},
  { dshxWireCode: 'directory-version-unsupported' },
) {
  override get message(): string {
    return 'The multi-host directory has an unsupported schema and was left untouched.'
  }
}

export class DirectoryRecordInvalid extends Schema.TaggedError<DirectoryRecordInvalid>()(
  'DirectoryRecordInvalid',
  { issue: Schema.String.check(Schema.isMaxLength(2_000)) },
  { dshxWireCode: 'directory-record-invalid' },
) {
  override get message(): string {
    return `The multi-host directory change was refused: ${this.issue}`
  }
}

export class DirectoryWriteFailed extends Schema.TaggedError<DirectoryWriteFailed>()(
  'DirectoryWriteFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'directory-write-failed' },
) {
  override get message(): string {
    return 'The multi-host directory could not be committed atomically.'
  }
}

export class HostConnectorInUse extends Schema.TaggedError<HostConnectorInUse>()(
  'HostConnectorInUse',
  { hostId: Schema.String },
  { dshxWireCode: 'host-connector-in-use' },
) {
  override get message(): string {
    return 'The host connector cannot change while registered runtimes use it.'
  }
}

export class HostNotFound extends Schema.TaggedError<HostNotFound>()('HostNotFound', { hostId: Schema.String }, { dshxWireCode: 'host-not-found' }) {
  override get message(): string {
    return `No recorded host ${this.hostId}.`
  }
}

export class HostOrderIncomplete extends Schema.TaggedError<HostOrderIncomplete>()('HostOrderIncomplete', {}, { dshxWireCode: 'host-order-incomplete' }) {
  override get message(): string {
    return 'A host order names every recorded host exactly once.'
  }
}

export class ConnectorKindMismatch extends Schema.TaggedError<ConnectorKindMismatch>()(
  'ConnectorKindMismatch',
  {},
  { dshxWireCode: 'connector-kind-mismatch' },
) {
  override get message(): string {
    return 'The runtime locator does not match its recorded host.'
  }
}

export class HostHasRuntimes extends Schema.TaggedError<HostHasRuntimes>()(
  'HostHasRuntimes',
  { hostId: Schema.String },
  { dshxWireCode: 'host-has-runtimes' },
) {
  override get message(): string {
    return 'The host still has runtime references; use --directory-only to remove those references. Remote data is retained.'
  }
}

export class RuntimeNotFound extends Schema.TaggedError<RuntimeNotFound>()(
  'RuntimeNotFound',
  { runtimeId: Schema.String },
  { dshxWireCode: 'runtime-not-found' },
) {
  override get message(): string {
    return 'No recorded runtime has this id.'
  }
}

export class OriginPortExhausted extends Schema.TaggedError<OriginPortExhausted>()('OriginPortExhausted', {}, { dshxWireCode: 'origin-port-exhausted' }) {
  override get message(): string {
    return 'No stable browser origin port is available for this runtime.'
  }
}

export class IdentityPathInvalid extends Schema.TaggedError<IdentityPathInvalid>()('IdentityPathInvalid', {}, { dshxWireCode: 'identity-path-invalid' }) {
  override get message(): string {
    return 'The runtime identity must be stored in a regular file inside a private directory.'
  }
}

export class IdentityUnreadable extends Schema.TaggedError<IdentityUnreadable>()(
  'IdentityUnreadable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'identity-unreadable' },
) {
  override get message(): string {
    return 'The runtime identity file could not be read.'
  }
}

export class IdentityCorrupt extends Schema.TaggedError<IdentityCorrupt>()('IdentityCorrupt', {}, { dshxWireCode: 'identity-corrupt' }) {
  override get message(): string {
    return 'The runtime identity file has an unsupported shape and was left untouched.'
  }
}

export class IdentityWriteFailed extends Schema.TaggedError<IdentityWriteFailed>()(
  'IdentityWriteFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'identity-write-failed' },
) {
  override get message(): string {
    return 'The runtime identity could not be committed atomically.'
  }
}

export class ProfileUnavailable extends Schema.TaggedError<ProfileUnavailable>()('ProfileUnavailable', {}, { dshxWireCode: 'profile-unavailable' }) {
  override get message(): string {
    return 'Set the multi-host profile field or launch DSH with --profile before registering this runtime.'
  }
}

export class ProfileMismatch extends Schema.TaggedError<ProfileMismatch>()(
  'ProfileMismatch',
  { reason: Schema.Literals(['setting', 'recorded']) },
  { dshxWireCode: 'profile-mismatch' },
) {
  override get message(): string {
    if (this.reason === 'recorded') return 'The recorded runtime identity belongs to a different DSH profile.'
    return 'The multi-host profile setting does not match the running DSH profile.'
  }
}

export class GatewayUnreachable extends Schema.TaggedError<GatewayUnreachable>()(
  'GatewayUnreachable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'gateway-unreachable' },
) {
  override get message(): string {
    return 'Could not reach the runtime through its recorded connector.'
  }
}

export class AuthenticationFailed extends Schema.TaggedError<AuthenticationFailed>()('AuthenticationFailed', {}, { dshxWireCode: 'authentication-failed' }) {
  override get message(): string {
    return 'The runtime rejected its saved launch credential.'
  }
}

export class RuntimeNotReady extends Schema.TaggedError<RuntimeNotReady>()('RuntimeNotReady', {}, { dshxWireCode: 'runtime-not-ready' }) {
  override get message(): string {
    return 'The runtime did not complete its authenticated launch handoff.'
  }
}

export class AuthenticationExpired extends Schema.TaggedError<AuthenticationExpired>()(
  'AuthenticationExpired',
  {},
  { dshxWireCode: 'authentication-expired' },
) {
  override get message(): string {
    return 'The runtime rejected its authenticated session; reconnect and verify its identity.'
  }
}

export class GatewayHttpError extends Schema.TaggedError<GatewayHttpError>()(
  'GatewayHttpError',
  { endpoint: Schema.String, status: Schema.Number },
  { dshxWireCode: 'gateway-http-error' },
) {
  override get message(): string {
    return `The runtime API returned HTTP ${this.status} for ${this.endpoint}.`
  }
}

export class InvalidResponse extends Schema.TaggedError<InvalidResponse>()(
  'InvalidResponse',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'invalid-response' },
) {
  override get message(): string {
    return 'The runtime replied outside the expected contract.'
  }
}

export class RequestTooLarge extends Schema.TaggedError<RequestTooLarge>()('RequestTooLarge', {}, { dshxWireCode: 'request-too-large' }) {
  override get message(): string {
    return 'The runtime API request exceeded the 48 MB transport limit.'
  }
}

export class ResponseTooLarge extends Schema.TaggedError<ResponseTooLarge>()('ResponseTooLarge', {}, { dshxWireCode: 'response-too-large' }) {
  override get message(): string {
    return 'The runtime API response exceeded the allowed size.'
  }
}

export class InvalidEndpoint extends Schema.TaggedError<InvalidEndpoint>()('InvalidEndpoint', {}, { dshxWireCode: 'invalid-endpoint' }) {
  override get message(): string {
    return 'The requested runtime endpoint is invalid.'
  }
}

/** A failure the remote runtime reported for one request; `code` is the runtime's own code. */
export class RemoteRequestFailed extends Schema.TaggedError<RemoteRequestFailed>()(
  'RemoteRequestFailed',
  { code: Schema.String.check(Schema.isMaxLength(128)), detail: Schema.String.check(Schema.isMaxLength(1_000)) },
  { dshxWireCode: 'remote-request-failed' },
) {
  override get message(): string {
    return this.detail
  }
}

export class StreamTimedOut extends Schema.TaggedError<StreamTimedOut>()('StreamTimedOut', { endpoint: Schema.String }, { dshxWireCode: 'stream-timeout' }) {
  override get message(): string {
    return `${this.endpoint} did not return a snapshot within its time limit.`
  }
}

export class StreamUnreachable extends Schema.TaggedError<StreamUnreachable>()('StreamUnreachable', {}, { dshxWireCode: 'stream-unreachable' }) {
  override get message(): string {
    return 'Could not open the runtime stream.'
  }
}

export class StreamClosed extends Schema.TaggedError<StreamClosed>()('StreamClosed', {}, { dshxWireCode: 'stream-closed' }) {
  override get message(): string {
    return 'The runtime stream closed before returning a snapshot.'
  }
}

export class StreamEnded extends Schema.TaggedError<StreamEnded>()('StreamEnded', {}, { dshxWireCode: 'stream-ended' }) {
  override get message(): string {
    return 'The runtime stream ended before its snapshot arrived.'
  }
}

export class StreamOverflow extends Schema.TaggedError<StreamOverflow>()('StreamOverflow', {}, { dshxWireCode: 'stream-overflow' }) {
  override get message(): string {
    return 'The runtime stream sent too many frames before its snapshot.'
  }
}

/** A failure frame the remote runtime sent on a stream; `code` is the runtime's own code. */
export class StreamFailed extends Schema.TaggedError<StreamFailed>()(
  'StreamFailed',
  { code: Schema.String.check(Schema.isMaxLength(128)), detail: Schema.String.check(Schema.isMaxLength(1_000)) },
  { dshxWireCode: 'stream-error' },
) {
  override get message(): string {
    return this.detail
  }
}

export class ApiUnreachable extends Schema.TaggedError<ApiUnreachable>()(
  'ApiUnreachable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'api-unreachable' },
) {
  override get message(): string {
    return 'The runtime request failed. Check the host status and reconnect if needed.'
  }
}

/** A plugin API on the remote runtime failed; `code` is that API's own code. */
export class RemoteApiFailed extends Schema.TaggedError<RemoteApiFailed>()(
  'RemoteApiFailed',
  { code: Schema.String.check(Schema.isMaxLength(128)), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'remote-api-failed' },
) {
  override get message(): string {
    return 'The runtime request failed. Check the host status and reconnect if needed.'
  }
}

export class LoopbackUnavailable extends Schema.TaggedError<LoopbackUnavailable>()(
  'LoopbackUnavailable',
  { port: Schema.Number },
  { dshxWireCode: 'loopback-address-unavailable' },
) {
  override get message(): string {
    return 'The runtime loopback origin is unavailable on this machine.'
  }
}

export class LoopbackForwardUnavailable extends Schema.TaggedError<LoopbackForwardUnavailable>()(
  'LoopbackForwardUnavailable',
  {},
  { dshxWireCode: 'loopback-forward-unavailable' },
) {
  override get message(): string {
    return 'The isolated local runtime listener could not be created.'
  }
}

export class InvalidRuntimeLocator extends Schema.TaggedError<InvalidRuntimeLocator>()(
  'InvalidRuntimeLocator',
  {},
  { dshxWireCode: 'invalid-runtime-locator' },
) {
  override get message(): string {
    return 'The runtime locator is invalid; a local runtime must use a tokenized HTTP loopback launch URL.'
  }
}

export class IdentityUnavailable extends Schema.TaggedError<IdentityUnavailable>()(
  'IdentityUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'identity-unavailable' },
) {
  override get message(): string {
    return 'The connected runtime did not provide the multi-host identity API. Install @dshfiles/multi-host there.'
  }
}

export class IdentityInvalid extends Schema.TaggedError<IdentityInvalid>()('IdentityInvalid', {}, { dshxWireCode: 'identity-invalid' }) {
  override get message(): string {
    return 'The connected runtime returned an identity outside the supported contract.'
  }
}

export class RuntimeIncompatible extends Schema.TaggedError<RuntimeIncompatible>()('RuntimeIncompatible', {}, { dshxWireCode: 'runtime-incompatible' }) {
  override get message(): string {
    return 'The connected runtime does not report a supported DSH 0.2 protocol version.'
  }
}

export class RuntimeCapabilityMissing extends Schema.TaggedError<RuntimeCapabilityMissing>()(
  'RuntimeCapabilityMissing',
  {},
  { dshxWireCode: 'runtime-capability-missing' },
) {
  override get message(): string {
    return 'The connected runtime does not provide the required workspace, session, and agent capabilities.'
  }
}

export class IdentityMismatch extends Schema.TaggedError<IdentityMismatch>()(
  'IdentityMismatch',
  { reason: Schema.Literals(['unpinned', 'changed', 'home', 'selected-home', 'other-host']) },
  { dshxWireCode: 'identity-mismatch' },
) {
  override get message(): string {
    if (this.reason === 'unpinned') return 'This runtime has no pinned identity. Re-register it before use.'
    if (this.reason === 'home') return 'The connected runtime home does not match its registered SSH home.'
    if (this.reason === 'selected-home') return 'The connected runtime home does not match the SSH home you selected.'
    if (this.reason === 'other-host') return 'This runtime identity is already registered under a different host.'
    return 'The connected runtime identity changed. Verify the host and runtime before reconnecting.'
  }
}

/** What ssh's own stderr says went wrong with the connection, before the remote command ran. */
export type SshConnectionError = SshHostKeyRejected | SshAuthenticationFailed | SshHostUnresolved | SshUnreachable

export type SshRunError = SshTargetInvalid | SshUnavailable | SshInputTooLarge

export type SshExecError = SshRunError | SshOutputTooLarge | SshTimedOut | SshConnectionError | SshCommandFailed

export type SshTunnelError = SshTargetInvalid | SshUnavailable | SshConnectionError | TunnelFailed | TunnelTimedOut

export type DirectoryReadError = DirectoryPathInvalid | DirectoryUnreadable | DirectoryCorrupt | DirectoryVersionUnsupported

export type DirectoryWriteError = DirectoryReadError | DirectoryWriteFailed | DirectoryRecordInvalid

/** Failures that mean the connection itself is gone, so the next call should open a fresh one. */
export const TransportFailure = Schema.Union([GatewayUnreachable, AuthenticationExpired, StreamUnreachable, StreamClosed, ApiUnreachable])
export type TransportFailure = typeof TransportFailure.Type
export const isTransportFailure = Schema.is(TransportFailure)

export type GatewayRequestError =
  | TransportFailure
  | GatewayHttpError
  | InvalidResponse
  | RequestTooLarge
  | ResponseTooLarge
  | InvalidEndpoint
  | RemoteRequestFailed

export type GatewayStreamError =
  | StreamUnreachable
  | StreamClosed
  | StreamEnded
  | StreamOverflow
  | StreamTimedOut
  | StreamFailed
  | InvalidResponse
  | InvalidEndpoint

export type PluginApiError = ApiUnreachable | AuthenticationExpired | RemoteApiFailed

export type GatewayConnectError = GatewayUnreachable | AuthenticationFailed | RuntimeNotReady | InvalidRuntimeLocator

export type RuntimeIdentityCheckError = IdentityUnavailable | IdentityInvalid | RuntimeIncompatible | RuntimeCapabilityMissing | IdentityMismatch

const wireCodeAt = SchemaAST.resolveAt<string>('dshxWireCode')

/** Any failure of this plugin: a tagged error class. */
export interface TaggedFailure {
  readonly _tag: string
}

/**
 * The code a value-returning handler reports for a failure: the runtime's own code for a remote failure, otherwise
 * the class's wire code.
 */
export const failureCodeOf = (error: TaggedFailure): string => {
  if (error instanceof RemoteRequestFailed || error instanceof StreamFailed || error instanceof RemoteApiFailed) return error.code
  const code = Schema.isSchema(error.constructor) ? wireCodeAt(error.constructor.ast) : undefined
  if (code !== undefined) return code
  return error._tag
}
