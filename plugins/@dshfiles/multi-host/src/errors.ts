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

/** What ssh's own stderr says went wrong with the connection, before the remote command ran. */
export type SshConnectionError = SshHostKeyRejected | SshAuthenticationFailed | SshHostUnresolved | SshUnreachable

export type SshRunError = SshTargetInvalid | SshUnavailable | SshInputTooLarge

export type SshExecError = SshRunError | SshOutputTooLarge | SshTimedOut | SshConnectionError | SshCommandFailed

export type SshTunnelError = SshTargetInvalid | SshUnavailable | SshConnectionError | TunnelFailed | TunnelTimedOut
