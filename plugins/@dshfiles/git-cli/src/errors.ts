import { Schema } from 'effect'

/** git could not be started, did not finish in time, or printed more than the run keeps. */
export class GitRunFailed extends Schema.TaggedError<GitRunFailed>()('GitRunFailed', {
  verb: Schema.String,
  reason: Schema.Literals(['spawn-failed', 'output-read-failed', 'timed-out', 'output-truncated']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    if (this.reason === 'spawn-failed') return `git ${this.verb} could not be started; install git or check the Host PATH.`
    if (this.reason === 'output-read-failed') return `git ${this.verb}: reading its output failed.`
    if (this.reason === 'timed-out') return `git ${this.verb} did not finish in time and was stopped.`
    return `git ${this.verb} printed more than the safe output limit; refusing incomplete repository data.`
  }
}

/** A git run that exited non-zero. `args` has its flag values redacted and `stderr` its credentials. */
export class GitCommandFailed extends Schema.TaggedError<GitCommandFailed>()('GitCommandFailed', {
  verb: Schema.String,
  args: Schema.Array(Schema.String),
  exitCode: Schema.Number,
  stderr: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  /** The first stderr lines, already redacted, or the exit code when git printed nothing. */
  get detail(): string {
    return this.stderr.trim().slice(0, 400) || `exited with code ${String(this.exitCode)}`
  }

  override get message(): string {
    return `git ${this.verb}: ${this.detail}`
  }
}

export type GitExecError = GitRunFailed | GitCommandFailed
