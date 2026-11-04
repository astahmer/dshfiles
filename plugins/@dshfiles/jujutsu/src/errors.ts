import { Schema } from 'effect'

/** The repository id names no registration: it expired, was evicted, or never existed on this Host. */
export class RepositoryNotFound extends Schema.TaggedError<RepositoryNotFound>()(
  'RepositoryNotFound',
  { repoId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'repository-not-found' },
) {
  override get message(): string {
    return 'Repository registration expired. Select it again.'
  }
}

const repositoryMovedMessages = {
  unavailable: 'Registered repository path is unavailable. Select it again.',
  changed: 'Registered repository directory changed. Select it again.',
  'before-command': 'Repository identity changed before command start.',
  'during-command': 'Repository directory changed during command execution.',
  'root-changed': 'Repository root changed during registration.',
  'root-mismatch': 'Registered path no longer resolves to the selected Jujutsu repository.',
} as const

/** The registered directory is gone or another directory took its place (its device and inode changed). */
export class RepositoryMoved extends Schema.TaggedError<RepositoryMoved>()(
  'RepositoryMoved',
  {
    reason: Schema.Literals(['unavailable', 'changed', 'before-command', 'during-command', 'root-changed', 'root-mismatch']),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'repository-moved' },
) {
  override get message(): string {
    return repositoryMovedMessages[this.reason]
  }
}

const invalidRepositoryPathMessages = {
  relative: 'Choose an absolute repository path.',
  'filesystem-root': 'Choose a repository directory, not a filesystem root.',
  missing: 'Selected repository path does not exist.',
  'not-canonical': 'Selected repository path is not canonical.',
  'not-directory': 'Selected repository path is not a directory.',
  symlink: 'Registered repository path changed through a symlink.',
} as const

/** A selected path that cannot name a repository directory. */
export class InvalidRepositoryPath extends Schema.TaggedError<InvalidRepositoryPath>()(
  'InvalidRepositoryPath',
  { reason: Schema.Literals(['relative', 'filesystem-root', 'missing', 'not-canonical', 'not-directory', 'symlink']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'invalid-repository-path' },
) {
  override get message(): string {
    return invalidRepositoryPathMessages[this.reason]
  }
}

const notAJujutsuRepositoryMessages = {
  unconfirmed: 'Jujutsu did not confirm a repository root for this directory.',
  'unavailable-root': 'Jujutsu returned an unavailable repository root.',
  'outside-selection': 'Jujutsu returned a repository root outside the selected directory tree.',
} as const

/** `jj root` answered, but not with a root that contains the selected directory. */
export class NotAJujutsuRepository extends Schema.TaggedError<NotAJujutsuRepository>()(
  'NotAJujutsuRepository',
  { reason: Schema.Literals(['unconfirmed', 'unavailable-root', 'outside-selection']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'not-a-jujutsu-repository' },
) {
  override get message(): string {
    return notAJujutsuRepositoryMessages[this.reason]
  }
}

const repositoryInitFailedMessages = {
  path: 'Selected repository path must be an existing directory.',
  missing: 'Selected directory is not inside an existing Git or Jujutsu checkout.',
  marker: 'Repository metadata is invalid. Existing metadata was left untouched.',
  changed: 'Repository identity changed before initialization. Open the repository again.',
  existing: 'Existing Jujutsu metadata could not be opened. It was left untouched.',
  init: 'Jujutsu could not initialize this Git checkout. Existing files and metadata were not replaced.',
  worktree: 'Jujutsu could not initialize this Git worktree. This JJ version may not support Git worktrees; existing metadata was not replaced.',
  root: 'Jujutsu did not confirm the exact selected repository root.',
} as const

/** Opening a folder as a Jujutsu repository refused or failed; existing metadata is never replaced. */
export class RepositoryInitFailed extends Schema.TaggedError<RepositoryInitFailed>()(
  'RepositoryInitFailed',
  { reason: Schema.Literals(['path', 'missing', 'marker', 'changed', 'existing', 'init', 'worktree', 'root']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'repository-init-failed' },
) {
  override get message(): string {
    return repositoryInitFailedMessages[this.reason]
  }
}

const previewExpiredMessages = {
  expired: 'Preview expired or was already used. Prepare the action again.',
  repository: 'The repository at this path changed after the preview. Select it again, then prepare the action again.',
  'target-changed': 'A revision or bookmark this action names changed after the preview. Refresh and prepare the action again.',
  'remote-changed': 'The remote configuration changed after the preview. Refresh and prepare the action again.',
} as const

/**
 * A prepared action is one-use, expires after five minutes and is bound to the revisions, bookmark, remote and
 * workspace it names. Each refusal names its own cause; changes elsewhere in the repository do not refuse it.
 */
export class PreviewExpired extends Schema.TaggedError<PreviewExpired>()(
  'PreviewExpired',
  {
    previewId: Schema.String,
    reason: Schema.Literals(['expired', 'repository', 'target-changed', 'remote-changed']),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'preview-expired' },
) {
  override get message(): string {
    return previewExpiredMessages[this.reason]
  }
}

const workspaceChangedMessages = {
  destination: 'Workspace destination changed after preview. Prepare the action again.',
  moved: 'Workspace changed after preview. Refresh and prepare the move again.',
  unvalidated: 'Workspace destination was not validated.',
} as const

/** The workspace a preview named is no longer where the preview found it. */
export class WorkspaceChanged extends Schema.TaggedError<WorkspaceChanged>()(
  'WorkspaceChanged',
  { reason: Schema.Literals(['destination', 'moved', 'unvalidated']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'workspace-changed' },
) {
  override get message(): string {
    return workspaceChangedMessages[this.reason]
  }
}

const workspaceDestinationInvalidMessages = {
  name: 'Choose a valid Jujutsu workspace name.',
  parent: 'Choose an existing parent directory for the new workspace.',
  'inside-repository': 'Choose a sibling workspace path outside the registered repository tree.',
  exists: 'Workspace destination already exists. Choose a new directory name.',
} as const

/** A new workspace folder must be a fresh sibling of the repository under an existing parent. */
export class WorkspaceDestinationInvalid extends Schema.TaggedError<WorkspaceDestinationInvalid>()(
  'WorkspaceDestinationInvalid',
  { reason: Schema.Literals(['name', 'parent', 'inside-repository', 'exists']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'workspace-destination-invalid' },
) {
  override get message(): string {
    return workspaceDestinationInvalidMessages[this.reason]
  }
}

const mutationRefusedReasons = [
  'message-limit',
  'invalid-revision',
  'split-paths',
  'squash-same',
  'rebase-same',
  'bookmark-move',
  'bookmark-name',
  'remote-name',
  'push-target',
  'workspace-target',
  'workspace-name',
  'default-workspace',
  'abandon-empty',
  'revert-same',
  'revision-gone',
  'immutable',
  'selection-immutable',
  'source-immutable',
  'bookmark-gone',
  'bookmark-unlisted',
  'remote-gone',
  'already-working-copy',
  'not-working-copy',
  'unlisted-paths',
  'workspace-gone',
  'only-workspace',
] as const

const mutationRefusedMessages = {
  'message-limit': 'Descriptions must fit the supported message limit and cannot contain null bytes.',
  'invalid-revision': 'Invalid revision id.',
  'split-paths': 'Split paths must be listed workspace-relative file names without traversal or null bytes.',
  'squash-same': 'Choose two different visible revisions to squash.',
  'rebase-same': 'Choose two different visible revisions to rebase.',
  'bookmark-move': 'Invalid bookmark move.',
  'bookmark-name': 'Invalid bookmark name.',
  'remote-name': 'Invalid remote name.',
  'push-target': 'Invalid push target.',
  'workspace-target': 'Choose a valid workspace name and visible revision.',
  'workspace-name': 'Choose a valid workspace name.',
  'default-workspace': 'Workspace default cannot be removed; it is the repository main workspace.',
  'abandon-empty': 'Choose at least one revision to abandon.',
  'revert-same': 'Choose a different revision to revert onto.',
  'revision-gone': 'Revision is no longer visible. Refresh and try again.',
  immutable: 'Jujutsu marks this revision immutable.',
  'selection-immutable': 'Jujutsu marks a selected revision immutable.',
  'source-immutable': 'Jujutsu marks the source revision immutable.',
  'bookmark-gone': 'Bookmark is no longer present. Refresh and try again.',
  'bookmark-unlisted': 'Bookmark is no longer present. Refresh and choose a listed bookmark.',
  'remote-gone': 'Remote is no longer configured. Refresh and select a listed remote.',
  'already-working-copy': 'This revision is already the working copy.',
  'not-working-copy': 'Only the working-copy revision can be committed.',
  'unlisted-paths': 'Selected files must be listed in this revision and use safe literal paths.',
  'workspace-gone': 'Workspace is no longer present. Refresh and try again.',
  'only-workspace': 'Workspace removal refused: this is the repository’s only workspace.',
} satisfies Record<(typeof mutationRefusedReasons)[number], string>

/** A Source Control action that cannot be previewed or built against the current repository state. */
export class MutationRefused extends Schema.TaggedError<MutationRefused>()(
  'MutationRefused',
  { reason: Schema.Literals(mutationRefusedReasons), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'mutation-refused' },
) {
  override get message(): string {
    return mutationRefusedMessages[this.reason]
  }
}

/** A revision reference that does not resolve to exactly one visible revision. */
export class RevisionNotFound extends Schema.TaggedError<RevisionNotFound>()(
  'RevisionNotFound',
  {
    reason: Schema.Literals(['ambiguous', 'no-match', 'multiple', 'unavailable', 'not-at-operation', 'reference']),
    reference: Schema.String,
    candidates: Schema.Array(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'revision-not-found' },
) {
  override get message(): string {
    if (this.reason === 'ambiguous') return `"${this.reference}" is a prefix of more than one revision. Use a longer prefix, or the full commit id from jj log.`
    if (this.reason === 'no-match') return `No revision matches "${this.reference}". Check the id against jj log and try again.`
    if (this.reason === 'multiple')
      return `"${this.reference}" names ${String(this.candidates.length)} divergent revisions (${this.candidates.join(', ')}). Pass the full commit id of the one you mean, from jj log.`
    if (this.reason === 'unavailable') return 'Revision ' + this.reference.slice(0, 12) + ' is no longer available. Refresh and try again.'
    if (this.reason === 'not-at-operation') return 'Revision is unavailable at this operation.'
    return 'That reference does not name one revision in this repository. Use a commit id or change id prefix, or a bookmark, from jj log.'
  }
}

const outputLimitMessages = {
  'revision-graph': 'Revision graph exceeded the bounded output limit.',
  'revision-lookup': 'Revision lookup exceeded the bounded output limit.',
  'changed-files': 'Changed file list exceeded the bounded output limit.',
  operation: 'Revision operation exceeded the output limit.',
  'revision-ids': 'Revision IDs exceeded the bounded output limit.',
  'revision-count': 'Revision exact count exceeded the bounded output limit.',
  bookmarks: 'Bookmark resolution exceeded the bounded output limit.',
  'reference-graph': 'The reference graph exceeded the bounded output limit.',
} as const

/** A read whose complete answer exceeded its bounded output, so a partial answer would be wrong. */
export class OutputLimitExceeded extends Schema.TaggedError<OutputLimitExceeded>()(
  'OutputLimitExceeded',
  {
    subject: Schema.Literals([
      'revision-graph',
      'revision-lookup',
      'changed-files',
      'operation',
      'revision-ids',
      'revision-count',
      'bookmarks',
      'reference-graph',
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'output-limit-exceeded' },
) {
  override get message(): string {
    return outputLimitMessages[this.subject]
  }
}

/**
 * jj exited non-zero. Its stderr can carry credential-bearing remote URLs, so only the exit code is public; the
 * `cause` is jj-cli's `JjCommandFailed` with redacted arguments and stderr, for the Host log.
 */
export class JujutsuCommandFailed extends Schema.TaggedError<JujutsuCommandFailed>()(
  'JujutsuCommandFailed',
  { exitCode: Schema.Number, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'jujutsu-command-failed' },
) {
  override get message(): string {
    return 'Jujutsu command failed with exit code ' + String(this.exitCode) + '.'
  }
}

export class JujutsuTimedOut extends Schema.TaggedError<JujutsuTimedOut>()(
  'JujutsuTimedOut',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'jujutsu-timed-out' },
) {
  override get message(): string {
    return 'Jujutsu command timed out.'
  }
}

/** jj could not be resolved, started or read. */
export class JujutsuUnavailable extends Schema.TaggedError<JujutsuUnavailable>()(
  'JujutsuUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'jujutsu-unavailable' },
) {
  override get message(): string {
    return 'Jujutsu could not run in the selected repository.'
  }
}

/** jj printed a record its template does not produce; kept off the wire, so reads answer their generic message. */
export class InvalidJjOutput extends Schema.TaggedError<InvalidJjOutput>()('InvalidJjOutput', { cause: Schema.optional(Schema.Defect()) }) {
  override get message(): string {
    return 'Jujutsu returned an unreadable revision record.'
  }
}

/** A Session cwd outside every JJ workspace. */
export class WorkspaceNotFound extends Schema.TaggedError<WorkspaceNotFound>()(
  'WorkspaceNotFound',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'workspace-not-found' },
) {
  override get message(): string {
    return 'Jujutsu could not find a workspace for this Session.'
  }
}

export class ReviewMarkInvalid extends Schema.TaggedError<ReviewMarkInvalid>()(
  'ReviewMarkInvalid',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'review-mark-invalid' },
) {
  override get message(): string {
    return 'A file without a content digest cannot be marked reviewed.'
  }
}

export class ReviewProgressUnavailable extends Schema.TaggedError<ReviewProgressUnavailable>()(
  'ReviewProgressUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'review-progress-unavailable' },
) {
  override get message(): string {
    return 'Jujutsu review progress storage is unavailable.'
  }
}

/** Every failure a jj run reports, after the repository identity guard. */
export type JjRunError = JujutsuCommandFailed | JujutsuTimedOut | JujutsuUnavailable | InvalidRepositoryPath | RepositoryMoved

/** Every failure a revision read reports. */
export type ReadError = JjRunError | RepositoryNotFound | OutputLimitExceeded | RevisionNotFound | InvalidJjOutput
