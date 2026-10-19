/**
 * The New thread screen, not a conversation: the strip belongs under the hero composer that chooses where a thread
 * starts. `blank` alone stays true while the first prompt travels to the Host, so an engaged Session must be excluded
 * too — otherwise the strip follows a thread that already has a message. Mirrors the phase the native composer uses.
 */
export const isNewThreadScreen = (session: { readonly blank: boolean; readonly running: boolean; readonly promptAttempted: boolean }): boolean =>
  session.blank && !session.running && !session.promptAttempted
