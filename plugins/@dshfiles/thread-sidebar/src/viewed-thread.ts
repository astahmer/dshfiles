export interface WindowAttention {
  readonly visible: boolean
  readonly focused: boolean
}

/** Whether the user is already looking at a thread, so an alert about it would only interrupt them. */
export class ViewedThreadModel {
  /** The thread is the one open in this window, and the window is both visible and focused. */
  static readonly isWatched = (input: WindowAttention & { readonly sessionId: string; readonly viewedSessionId: string | undefined }): boolean =>
    input.visible && input.focused && input.viewedSessionId === input.sessionId

  static readonly windowAttention = (): WindowAttention =>
    typeof document === 'undefined' ? { visible: false, focused: false } : { visible: document.visibilityState === 'visible', focused: document.hasFocus() }
}
