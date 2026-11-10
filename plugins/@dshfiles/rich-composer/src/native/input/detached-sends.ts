/**
 * Editor-side state owner for detached default sends: the in-flight editor
 * snapshots, the failed sends waiting to be restored, and the document
 * revision the last restoration produced. The SessionInput shell captures a
 * snapshot, asks whether a failure must be written back, and reports the
 * revision its own restore produced; it keeps no buffering of its own.
 */
import type { DraftAttachmentId } from '../contract/input.ts'
import type { Occurrence } from '../contract/draft-editor.ts'

/** Editor and attachment snapshot owned by one detached default send. */
export interface DetachedSendRecord {
  readonly draft: string
  readonly occurrences: readonly Occurrence[]
  readonly attachmentIds: readonly DraftAttachmentId[]
}

/** Buffered failed sends written back as one semantic document. */
export interface FailedDraftRestore {
  readonly draft: string
  readonly occurrences: readonly Occurrence[]
}

const FAILURE_SEPARATOR = '\n\n'

/** Buffered state for the sends that left the editor and have not settled. */
export class DetachedSends {
  private readonly inflight = new Map<number, DetachedSendRecord>()
  private readonly failed = new Map<number, DetachedSendRecord>()
  private restoreRev: number | undefined
  private restoring = false

  /** Detached sends whose admission is still in flight. */
  get inflightCount(): number {
    return this.inflight.size
  }

  /** Retain the editor snapshot one detached send needs if its admission fails. */
  capture({ seq, record }: { seq: number; record: DetachedSendRecord }): void {
    this.inflight.set(seq, record)
  }

  /** Forget a settled send, returning the snapshot it retained. */
  settle(seq: number): DetachedSendRecord | undefined {
    const record = this.inflight.get(seq)
    this.inflight.delete(seq)
    return record
  }

  /**
   * Buffer one failed send.
   * @returns whether the editor must take the buffered drafts back now.
   */
  recordFailure({ seq, record, draft, rev }: { seq: number; record: DetachedSendRecord; draft: string; rev: number }): boolean {
    this.failed.set(seq, record)
    return draft === '' || this.restoreRev === rev
  }

  /**
   * Write the buffered failures through the editor, in submission order.
   * @param write - applies one semantic document and answers the revision it produced.
   */
  restore(write: (snapshot: FailedDraftRestore) => number): void {
    if (this.failed.size === 0) return
    const snapshot = this.bufferedSnapshot()
    this.restoring = true
    try {
      this.restoreRev = write(snapshot)
    } finally {
      this.restoring = false
    }
  }

  /** The editor saw other content: drop the buffers unless this owner just wrote them. */
  editorChanged(): void {
    if (this.restoring || this.restoreRev === undefined) return
    this.failed.clear()
    this.restoreRev = undefined
  }

  /** A send left the restored revision, so its buffered content is on its way. */
  sent({ rev }: { rev: number }): void {
    if (this.restoreRev !== rev) return
    this.failed.clear()
    this.restoreRev = undefined
  }

  /** Drop every retained snapshot on teardown. */
  clear(): void {
    this.inflight.clear()
    this.failed.clear()
    this.restoreRev = undefined
  }

  private bufferedSnapshot(): FailedDraftRestore {
    const records = [...this.failed.entries()].sort(([a], [b]) => a - b).map(([, record]) => record)
    const occurrences: Occurrence[] = []
    let draft = ''
    for (const record of records) {
      const base = draft.length + (draft === '' ? 0 : FAILURE_SEPARATOR.length)
      if (draft !== '') draft += FAILURE_SEPARATOR
      draft += record.draft
      for (const occurrence of record.occurrences) occurrences.push({ ...occurrence, offset: base + occurrence.offset })
    }
    return { draft, occurrences }
  }
}
