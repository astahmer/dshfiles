const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu
const AUTHORIZATION_VALUE = /\b(authorization|proxy-authorization)(\s*[:=]\s*)(?:(?:basic|bearer|token)\s+)?\S+/giu
const BEARER_TOKEN = /\b(bearer|token)(\s+)[a-z0-9._~+/=-]{8,}/giu
const SECRET_ASSIGNMENT = /\b([a-z0-9_-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)[a-z0-9_-]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/giu
const REDACTED = '<redacted>'

/**
 * git stderr with credentials removed: `fetch` and `push` print remote URLs such as `https://user:token@host/repo`, and
 * a credential helper can echo an authorization header. Everything else stays, so a failure remains diagnosable.
 */
export const redactGitStderr = (stderr: string): string =>
  stderr
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`)
    .replace(AUTHORIZATION_VALUE, `$1$2${REDACTED}`)
    .replace(BEARER_TOKEN, `$1$2${REDACTED}`)
    .replace(SECRET_ASSIGNMENT, `$1$2${REDACTED}`)
