/** Sent annotations: the passages a session's messages already carried, kept for review after the draft clears. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import z from '@deepseek-ai/schemastery'

/** One annotation attached to an accepted message, with its comment and quoted passage. */
export interface SentAnnotation {
  readonly id: number
  readonly text: string
  readonly comment: string
  readonly source: string
  /** When the message carrying it was accepted, in epoch milliseconds. */
  readonly sentAt: number
}

/** Most recent annotations kept per session; older ones drop from storage first. */
export const SENT_ANNOTATION_LIMIT = 200

const STORAGE_KEY_PREFIX = 'dshfiles-rich-composer:sent-annotations:'

const SentAnnotationSchema = z.object({
  id: z.number(),
  text: z.string(),
  comment: z.string(),
  source: z.string(),
  sentAt: z.number(),
})

const StoredSchema = z.array(SentAnnotationSchema)

interface AnnotationStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const browserStorage = (): AnnotationStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/**
 * Per-browser history of the annotations a session already sent, newest last. A send moves each draft
 * annotation here before the draft lets it go, so its marker and comment survive the message leaving the editor
 * and survive a reload. Storage failures degrade to this tab's memory.
 */
export class SentAnnotations {
  readonly state: SnapshotStore<readonly SentAnnotation[]> = createSnapshotStore<readonly SentAnnotation[]>([])
  private nextId = 1
  private readonly key: string

  /**
   * @param sessionId - session whose history this store owns.
   * @param storage - browser storage, or null in non-browser runs and tests.
   */
  constructor(sessionId: string, private readonly storage: AnnotationStorage | null = browserStorage()) {
    this.key = `${STORAGE_KEY_PREFIX}${sessionId}`
    const stored = SentAnnotations.decode(storage, this.key)
    if (stored.length > 0) this.state.set(stored)
    this.nextId = stored.reduce((next, annotation) => Math.max(next, annotation.id + 1), 1)
  }

  private static decode(storage: AnnotationStorage | null, key: string): readonly SentAnnotation[] {
    try {
      const parsed = StoredSchema(JSON.parse(storage?.getItem(key) ?? '[]'))
      return parsed
        .filter(annotation => annotation !== undefined)
        .map(annotation => ({
          id: annotation.id, text: annotation.text, comment: annotation.comment, source: annotation.source, sentAt: annotation.sentAt,
        }))
        .slice(-SENT_ANNOTATION_LIMIT)
    } catch {
      return []
    }
  }

  subscribe = (listener: () => void): (() => void) => this.state.subscribe(listener)

  snapshot = (): readonly SentAnnotation[] => this.state.getSnapshot()

  /**
   * Keep one annotation that an accepted message carried.
   * @param input - the quoted passage, its comment and the locator its surface recorded.
   * @returns the stored annotation.
   */
  add = (input: { readonly text: string; readonly source: string; readonly comment: string }): SentAnnotation => {
    const annotation: SentAnnotation = {
      id: this.nextId,
      text: input.text,
      comment: input.comment,
      source: input.source,
      sentAt: Date.now(),
    }
    this.nextId += 1
    this.write([...this.state.getSnapshot(), annotation].slice(-SENT_ANNOTATION_LIMIT))
    return annotation
  }

  setComment = (input: { readonly id: number; readonly comment: string }): void => {
    this.write(this.state.getSnapshot().map(annotation =>
      (annotation.id === input.id ? { ...annotation, comment: input.comment } : annotation)))
  }

  remove = (id: number): void => {
    this.write(this.state.getSnapshot().filter(annotation => annotation.id !== id))
  }

  private write(annotations: readonly SentAnnotation[]): void {
    this.state.set(annotations)
    try {
      this.storage?.setItem(this.key, JSON.stringify(annotations))
    } catch {
      // A full or unavailable storage keeps this tab's history.
    }
  }
}
