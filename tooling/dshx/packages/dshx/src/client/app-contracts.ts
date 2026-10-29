import { BrowserBroker, type Subscribable } from './broker.js'

/** The workspace files of the session on screen; `indexing` replies repeat as the listing grows. */
export type FilesListing =
  | { readonly status: 'no-session' }
  | { readonly status: 'indexing' | 'ready'; readonly sessionId: string; readonly files: readonly string[]; readonly truncated: boolean }

/** Workspace files of the session on screen, provided by the plugin that owns the file tree. */
export interface FilesService {
  /** Follow the file list; the returned function stops it, as does aborting `signal`. */
  watch(listener: (listing: FilesListing) => void, options?: { readonly signal?: AbortSignal }): () => void
  /**
   * Open a file in the editor, at a line when given; `path` is relative to `cwd`, or to the session's workspace without
   * it. False while no session is on screen.
   */
  open(input: { readonly path: string; readonly line?: number; readonly cwd?: string }): boolean
  /**
   * Open an absolute Host path in another application ("Open in"), the default one without `application`, or show it
   * in the file manager with `reveal`; false where the Host has no desktop or the opener failed.
   */
  openIn(input: { readonly path: string; readonly application?: string; readonly reveal?: boolean }): Promise<boolean>
}

/** Review a workspace's changes, provided by the plugin that owns the review page. */
export interface ChangesService {
  /** Show the review of `workspacePath`, scoped to one session's work when `sessionId` is given; false when it cannot. */
  review(input: { readonly workspacePath: string; readonly sessionId?: string }): boolean
}

/** The embedded browser pane beside the session on screen. */
export interface BrowserService {
  /** Whether this Host has a browser pane. */
  readonly available: Subscribable<boolean>
  /** Open an http(s) URL in the pane; false for another URL, without a pane or without a session on screen. */
  open(url: string): boolean
}

export const Files = BrowserBroker.defineContract<FilesService>('dshx.files')
export const Changes = BrowserBroker.defineContract<ChangesService>('dshx.changes')
export const Browser = BrowserBroker.defineContract<BrowserService>('dshx.browser')
