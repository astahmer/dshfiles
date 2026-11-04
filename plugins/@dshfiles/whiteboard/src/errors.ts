import { Schema } from 'effect'

export class BoardNotFound extends Schema.TaggedError<BoardNotFound>()('BoardNotFound', {}, { dshxWireCode: 'unknown-board' }) {
  override get message(): string {
    return 'This whiteboard does not exist. List the project’s boards with whiteboard_list (or reopen the Whiteboards page) and pick an existing one.'
  }
}

export class StaleBoardRevision extends Schema.TaggedError<StaleBoardRevision>()(
  'StaleBoardRevision',
  { currentRevision: Schema.Int },
  { dshxWireCode: 'stale-revision' },
) {
  override get message(): string {
    return `This whiteboard changed since it was read (now revision ${String(this.currentRevision)}). Read it again and reapply the change to the current scene.`
  }
}

export class BoardDeleted extends Schema.TaggedError<BoardDeleted>()('BoardDeleted', {}, { dshxWireCode: 'board-deleted' }) {
  override get message(): string {
    return 'This whiteboard is in Recently deleted. Restore it before editing it.'
  }
}

const invalidWrites = {
  'missing-project': 'A new whiteboard needs a project path and a title.',
  'missing-revision': 'Pass the expectedRevision returned by whiteboard_read or the previous write to change an existing whiteboard.',
  'two-sources': 'Pass at most one of mermaid or skeleton per write.',
  'scene-too-large':
    'The scene exceeds the 900 KiB a whiteboard can store (large images are the usual cause). Remove or crop images, or split the board, then retry.',
} as const

export class InvalidBoardWrite extends Schema.TaggedError<InvalidBoardWrite>()(
  'InvalidBoardWrite',
  { reason: Schema.Literals(['missing-project', 'missing-revision', 'two-sources', 'scene-too-large']) },
  { dshxWireCode: 'invalid-write' },
) {
  override get message(): string {
    return invalidWrites[this.reason]
  }
}

export class BoardStoreFailed extends Schema.TaggedError<BoardStoreFailed>()(
  'BoardStoreFailed',
  {
    operation: Schema.Literals(['open', 'list', 'read', 'write', 'rename', 'delete', 'restore']),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'board-store-failure' },
) {
  override get message(): string {
    return 'The whiteboard store could not complete this request. Retry once; if it keeps failing, check the Host log for the whiteboard store error.'
  }
}

export class UnsafeBoardStorage extends Schema.TaggedError<UnsafeBoardStorage>()(
  'UnsafeBoardStorage',
  { reason: Schema.Literals(['symbolic-link', 'not-directory', 'not-file']) },
  { dshxWireCode: 'unsafe-storage' },
) {
  override get message(): string {
    return 'The whiteboard directory under $DSH_HOME/plugins/whiteboard must be a private directory, not a symbolic link. Move the link aside and restart DSH.'
  }
}

export type BoardDomainError = BoardNotFound | StaleBoardRevision | BoardDeleted | InvalidBoardWrite | UnsafeBoardStorage
