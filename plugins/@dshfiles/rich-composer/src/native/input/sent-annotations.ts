/** Sent annotations on the browser side: the Host's per-session review history, hydrated and kept editable. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createApiClient } from '@dshfiles/dshx/client'
import type { Context } from '@deepseek-ai/cordis'
import { sentAnnotationsApi, SENT_ANNOTATION_LIMIT, type SentAnnotation } from '../../sent-annotations-api.ts'

/** One host-backed history for one Session. */
export interface SentAnnotationHistory {
  load(): Promise<readonly SentAnnotation[]>
  add(input: { readonly text: string; readonly comment: string; readonly source: string }): Promise<SentAnnotation>
  setComment(input: { readonly id: number; readonly comment: string }): Promise<boolean>
  remove(id: number): Promise<boolean>
}

/** Bind one Session's history to the Host API of this plugin. */
export const createHostAnnotationHistory = (ctx: Context, sessionId: string): SentAnnotationHistory => {
  let client: ReturnType<typeof createApiClient<typeof sentAnnotationsApi.methods>> | undefined
  const api = (): ReturnType<typeof createApiClient<typeof sentAnnotationsApi.methods>> => {
    client ??= createApiClient(ctx, sentAnnotationsApi, '@dshfiles/rich-composer')
    return client
  }
  return {
    load: async () => (await api().list({ sessionId })).annotations,
    add: async input => (await api().add({ sessionId, ...input })).annotation,
    setComment: async input => (await api().setComment({ sessionId, ...input })).updated,
    remove: async id => (await api().remove({ sessionId, id })).removed,
  }
}

/**
 * Per-session review history. A send inserts its annotation optimistically and the Host's durable record replaces it
 * once the write lands; comment edits and removals follow the stored id. Without a history (non-browser runs, probes)
 * the store stays in memory for the tab.
 */
export class SentAnnotations {
  readonly state: SnapshotStore<readonly SentAnnotation[]> = createSnapshotStore<readonly SentAnnotation[]>([])
  /** Negative ids are local placeholders; the Host assigns positive ones. */
  private nextTempId = -1

  /** @param history - the Host-backed record for this Session, absent when only this tab holds it. */
  constructor(private readonly history: SentAnnotationHistory | undefined) {
    if (history !== undefined) void this.hydrate()
  }

  private async hydrate(): Promise<void> {
    const history = this.history
    if (history === undefined) return
    try {
      const stored = await history.load()
      // A send that raced this read is either in the stored list already or still waiting for its write answer.
      const keyOf = (annotation: SentAnnotation): string => `${annotation.text}\u0000${annotation.comment}\u0000${annotation.source}`
      const known = new Set(stored.map(keyOf))
      const pending = this.state.getSnapshot().filter(annotation => !known.has(keyOf(annotation)))
      this.state.set([...stored, ...pending].slice(-SENT_ANNOTATION_LIMIT))
    } catch {
      // An unreachable Host leaves this tab's memory in place; the next send retries the API.
    }
  }

  subscribe = (listener: () => void): (() => void) => this.state.subscribe(listener)

  snapshot = (): readonly SentAnnotation[] => this.state.getSnapshot()

  /**
   * Keep one annotation that an accepted message carried.
   * @param input - the quoted passage, its comment and the locator its surface recorded.
   * @returns the placeholder annotation, replaced by the Host's record once written.
   */
  add = (input: { readonly text: string; readonly source: string; readonly comment: string }): SentAnnotation => {
    const placeholder: SentAnnotation = {
      id: this.nextTempId,
      text: input.text,
      comment: input.comment,
      source: input.source,
      sentAt: Date.now(),
    }
    this.nextTempId -= 1
    this.state.set([...this.state.getSnapshot(), placeholder].slice(-SENT_ANNOTATION_LIMIT))
    if (this.history !== undefined) {
      void this.history.add(input).then((stored) => {
        this.state.set(this.state.getSnapshot().map(annotation => (annotation.id === placeholder.id ? stored : annotation)))
      }).catch(() => {
        // The marker stays usable for this tab; a reload drops it because the Host never stored it.
      })
    }
    return placeholder
  }

  setComment = (input: { readonly id: number; readonly comment: string }): void => {
    this.state.set(this.state.getSnapshot().map(annotation =>
      (annotation.id === input.id ? { ...annotation, comment: input.comment } : annotation)))
    if (this.history === undefined || input.id < 0) return
    void this.history.setComment(input).catch(() => {})
  }

  remove = (id: number): void => {
    this.state.set(this.state.getSnapshot().filter(annotation => annotation.id !== id))
    if (this.history === undefined || id < 0) return
    void this.history.remove(id).catch(() => {})
  }
}
