import { Schema } from 'effect'

export class JjSpawnFailed extends Schema.TaggedError<JjSpawnFailed>()('JjSpawnFailed', {
  verb: Schema.String,
  reason: Schema.Literals(['executable-not-found', 'unsafe-executable', 'spawn-failed', 'output-read-failed']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    if (this.reason === 'executable-not-found') return 'The jj executable was not found on PATH.'
    if (this.reason === 'unsafe-executable') return 'The jj executable path is not an absolute, NUL-free path.'
    if (this.reason === 'output-read-failed') return `jj ${this.verb}: reading its output failed.`
    return `jj ${this.verb} could not be started.`
  }
}

export class JjTimedOut extends Schema.TaggedError<JjTimedOut>()('JjTimedOut', {
  verb: Schema.String,
  timeoutMillis: Schema.Number,
}) {
  override get message(): string {
    return `jj ${this.verb} did not finish within ${String(this.timeoutMillis)} ms and was stopped.`
  }
}

export class JjOutputTruncated extends Schema.TaggedError<JjOutputTruncated>()('JjOutputTruncated', {
  verb: Schema.String,
  maxBytes: Schema.Number,
}) {
  override get message(): string {
    return `jj ${this.verb} printed more than ${String(this.maxBytes)} bytes.`
  }
}

/** A jj run that exited non-zero. `args` has its flag values redacted and `stderr` its credentials. */
export class JjCommandFailed extends Schema.TaggedError<JjCommandFailed>()('JjCommandFailed', {
  verb: Schema.String,
  args: Schema.Array(Schema.String),
  exitCode: Schema.Number,
  stderr: Schema.String,
  stderrTruncated: Schema.Boolean,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `jj ${this.verb} exited with code ${String(this.exitCode)}.`
  }
}

export type JjRunError = JjSpawnFailed | JjTimedOut | JjOutputTruncated

export type JjExecError = JjRunError | JjCommandFailed
