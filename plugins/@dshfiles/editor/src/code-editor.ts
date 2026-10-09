/**
 * The editor seam (ADE decision 5): the panel only talks to this interface, so Monaco can later move to
 * `@codingame/monaco-vscode-api` or down to CodeMirror 6 by swapping the engine module.
 */
export interface EditorDocument {
  /** Stable id, unique across sessions. */
  readonly id: string
  /** Absolute path; the engine derives the language from its extension. */
  readonly path: string
  readonly text: string
}

export interface CodeEditorHandle {
  /** Show a document, creating its buffer on first open. */
  show(document: EditorDocument): void
  /** Replace a buffer's text and mark it clean (reload from disk). */
  reset(document: EditorDocument): void
  close(documentId: string): void
  reveal(documentId: string, line: number): void
  /** The buffer text with an opaque version, so a save can mark exactly what it wrote as clean. */
  snapshot(documentId: string): { readonly text: string; readonly version: number } | undefined
  isDirty(documentId: string): boolean
  markSaved(documentId: string, version: number): void
  setDark(dark: boolean): void
  focus(): void
  dispose(): void
}

export interface CodeEditorCallbacks {
  readonly onDirtyChange: (documentId: string, dirty: boolean) => void
  readonly onSave: () => void
}

export interface CodeEditorEngine {
  readonly name: string
  create(container: HTMLElement, options: { readonly dark: boolean } & CodeEditorCallbacks): CodeEditorHandle
}
