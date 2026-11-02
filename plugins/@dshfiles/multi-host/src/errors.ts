import { Schema } from 'effect'

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

/** What ssh's own stderr says went wrong with the connection, before the remote command ran. */
export type SshConnectionError = SshHostKeyRejected | SshAuthenticationFailed | SshHostUnresolved | SshUnreachable

export type SshRunError = SshTargetInvalid | SshUnavailable | SshInputTooLarge

export type SshExecError = SshRunError | SshOutputTooLarge | SshTimedOut | SshConnectionError | SshCommandFailed

export type SshTunnelError = SshTargetInvalid | SshUnavailable | SshConnectionError | TunnelFailed | TunnelTimedOut

export type DirectoryReadError = DirectoryPathInvalid | DirectoryUnreadable | DirectoryCorrupt | DirectoryVersionUnsupported

export type DirectoryWriteError = DirectoryReadError | DirectoryWriteFailed | DirectoryRecordInvalid
