import { Schema } from 'effect'

/** A path is not inside a jj repository, or the owning project stopped being one. */
export class NotARepository extends Schema.TaggedError<NotARepository>()(
  'NotARepository',
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'not-a-repository' },
) {
  override get message(): string {
    return this.detail
  }
}

/** A path is a jj workspace, but not a managed thread workspace. */
export class NotAThread extends Schema.TaggedError<NotAThread>()(
  'NotAThread',
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'not-a-thread' },
) {
  override get message(): string {
    return this.detail
  }
}

/** A jj command exited non-zero, timed out, overflowed its output limit or printed something this plugin cannot trust. */
export class JjFailed extends Schema.TaggedError<JjFailed>()(
  'JjFailed',
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'jj-failed' },
) {
  override get message(): string {
    return this.detail
  }
}

/** A git command exited non-zero, timed out, overflowed its output limit or printed something this plugin cannot trust. */
export class GitFailed extends Schema.TaggedError<GitFailed>()(
  'GitFailed',
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'git-failed' },
) {
  override get message(): string {
    return this.detail
  }
}

/** A workspace name would escape the threads directory, or now belongs to another jj workspace. */
export class UnsafePath extends Schema.TaggedError<UnsafePath>()(
  'UnsafePath',
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'unsafe-path' },
) {
  override get message(): string {
    return this.detail
  }
}

/** Reading or writing a thread workspace's files failed. */
export class WorkspaceFilesFailed extends Schema.TaggedError<WorkspaceFilesFailed>()(
  'WorkspaceFilesFailed',
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'workspace-files-failed' },
) {
  override get message(): string {
    return this.detail
  }
}

/** A Session in the workspace is working or waiting for an answer. */
export class ThreadActive extends Schema.TaggedError<ThreadActive>()(
  'ThreadActive',
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-active' },
) {
  override get message(): string {
    return this.detail
  }
}

/** The Host could not read whether the workspace's Sessions are idle. */
export class ThreadActivityUnknown extends Schema.TaggedError<ThreadActivityUnknown>()(
  'ThreadActivityUnknown',
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-activity-unknown' },
) {
  override get message(): string {
    return this.detail
  }
}

/** The rebase did not run now; it was queued until the workspace is verifiably idle. */
export class IntegrationQueued extends Schema.TaggedError<IntegrationQueued>()(
  'IntegrationQueued',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'integration-queued' },
) {
  override get message(): string {
    return 'This workspace is not verifiably idle yet; the integration is queued.'
  }
}

/** A queued integration was cancelled after its attempt started but before its rebase. */
export class IntegrationCancelled extends Schema.TaggedError<IntegrationCancelled>()(
  'IntegrationCancelled',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'integration-cancelled' },
) {
  override get message(): string {
    return 'The queued integration was cancelled.'
  }
}

/** The caller named no path and has no working directory to default to. */
export class NoPath extends Schema.TaggedError<NoPath>()(
  'NoPath',
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'no-path' },
) {
  override get message(): string {
    return this.detail
  }
}

/** Only an agent Session may make this call. */
export class AgentOnly extends Schema.TaggedError<AgentOnly>()('AgentOnly', { cause: Schema.optional(Schema.Defect()) }, { dshxWireCode: 'agent-only' }) {
  override get message(): string {
    return 'Only an agent Session can isolate its working directory.'
  }
}

/** The DSH workspace registry has no workspace with this id. */
export class WorkspaceNotFound extends Schema.TaggedError<WorkspaceNotFound>()(
  'WorkspaceNotFound',
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'workspace-not-found' },
) {
  override get message(): string {
    return this.detail
  }
}

/** A DSH Host service this plugin needs is missing or rejected the call. */
export class HostCallFailed extends Schema.TaggedError<HostCallFailed>()(
  'HostCallFailed',
  { service: Schema.String, operation: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'host-call-failed' },
) {
  override get message(): string {
    return `The DSH ${this.service} could not ${this.operation}. Retry; if it keeps failing, check the Host log.`
  }
}

export type ThreadWorkspaceError = NotARepository | NotAThread | JjFailed | GitFailed | UnsafePath | WorkspaceFilesFailed
