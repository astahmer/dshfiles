/**
 * Windows briefly locks files a build just wrote: antivirus and the search indexer open fresh bundles, and while they
 * hold one, opening it for writing fails with UNKNOWN, EPERM, EACCES or EBUSY, and renaming its directory fails with
 * EPERM. Those holds last milliseconds, so a file operation there is retried with a short backoff, as graceful-fs does.
 * Elsewhere the operation runs once: on POSIX these codes mean a real permission problem.
 */
const TRANSIENT_LOCK_CODES = new Set(['UNKNOWN', 'EPERM', 'EACCES', 'EBUSY'])

const isTransientLock = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && TRANSIENT_LOCK_CODES.has(error.code)

export const retryWindowsLock = async <A>(operation: () => Promise<A>, attempts = 20): Promise<A> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (process.platform !== 'win32' || attempt >= attempts || !isTransientLock(error)) throw error
      await new Promise(resolveDelay => setTimeout(resolveDelay, Math.min(50 * (attempt + 1), 500)))
    }
  }
}
