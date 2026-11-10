import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** One quoted passage of the conversation the user attached to the draft, with an optional comment. */
export interface DraftAnnotation {
  readonly id: number
  readonly text: string
  readonly comment: string
  /** Where the passage came from, as its quoting surface named it; empty when unknown. */
  readonly source: string
}

/** The draft's annotations: shown as one pill above the editor and sent ahead of the message text. */
export class DraftAnnotations {
  readonly state: SnapshotStore<readonly DraftAnnotation[]> = createSnapshotStore<readonly DraftAnnotation[]>([], { flush: 'sync' })
  private nextId = 1

  subscribe = (listener: () => void): (() => void) => this.state.subscribe(listener)

  snapshot = (): readonly DraftAnnotation[] => this.state.getSnapshot()

  add = (input: { readonly text: string; readonly source: string }): void => {
    const text = input.text.trim()
    if (text === '') return
    const id = this.nextId
    this.nextId += 1
    this.state.set([...this.state.getSnapshot(), { id, text, comment: '', source: input.source }])
  }

  setComment = (input: { readonly id: number; readonly comment: string }): void => {
    this.state.set(this.state.getSnapshot().map(annotation => (annotation.id === input.id ? { ...annotation, comment: input.comment.trim() } : annotation)))
  }

  remove = (id: number): void => {
    this.state.set(this.state.getSnapshot().filter(annotation => annotation.id !== id))
  }

  clear = (): void => {
    this.state.set([])
  }

  /** Empties the list for a send and returns what it held. */
  take = (): readonly DraftAnnotation[] => {
    const taken = this.state.getSnapshot()
    if (taken.length > 0) this.state.set([])
    return taken
  }

  /** Puts back the annotations of a failed send ahead of any added since. */
  restore = (annotations: readonly DraftAnnotation[]): void => {
    if (annotations.length > 0) this.state.set([...annotations, ...this.state.getSnapshot()])
  }

  /** The message the model reads: each quoted passage with its comment, then the user's text. */
  static compose = (input: { readonly annotations: readonly DraftAnnotation[]; readonly text: string }): string => {
    if (input.annotations.length === 0) return input.text
    const blocks = input.annotations.map((annotation, index) => {
      const quote = annotation.text
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n')
      const header = `Annotation ${String(index + 1)} on your previous reply:`
      return annotation.comment === '' ? `${header}\n${quote}` : `${header}\n${quote}\n\nComment: ${annotation.comment}`
    })
    return [...blocks, input.text].filter(part => part !== '').join('\n\n')
  }
}
