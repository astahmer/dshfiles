/**
 * The Host answers `session/not-found` for an identity it has not created yet (a client-only blank) and for one it no
 * longer has (a thread deleted or archived elsewhere). Both mean "there is no Session to configure", so the picker
 * keeps its default choices instead of reporting a failure the person cannot act on.
 */
const SESSION_NOT_FOUND = /(^|\b)session\/not-found\b|session "[^"]+" not found/iu

export const isSessionNotFound = (message: string): boolean => SESSION_NOT_FOUND.test(message)

/** The message a failed selection may show, or null when the Session simply has no Host identity. */
export const selectionFailureNotice = (message: string): string | null => (isSessionNotFound(message) ? null : message)
