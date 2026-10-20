/**
 * The New thread screen, not a conversation: the strip belongs under the hero composer that chooses where a thread
 * starts. `blank` alone stays true while the first prompt travels to the Host, so an engaged Session must be excluded
 * too — otherwise the strip follows a thread that already has a message. Mirrors the phase the native composer uses.
 *
 * The Session list's own `blank` for that Session is required as well: a Session object opens with a conservative blank
 * bit and can report it for a thread that has history until the details land. The list never calls that thread blank,
 * so waiting for both keeps the strip off a conversation that is merely still opening — no settle timer, no flash.
 */
export const isNewThreadScreen = (
  session: { readonly blank: boolean; readonly running: boolean; readonly promptAttempted: boolean },
  summaryBlank: boolean,
): boolean => summaryBlank && session.blank && !session.running && !session.promptAttempted
