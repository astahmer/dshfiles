import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'

/**
 * Read one generic-password item from the macOS login keychain, the store
 * Claude Code and Cursor CLI use for their logins. Fixed arguments only, never
 * a shell; any failure (no item, another platform, a denied prompt) reads as
 * absent so the caller reports "not signed in" rather than an error.
 */
export const readKeychainSecret = (input: { readonly service: string; readonly account?: string }): Promise<string | undefined> => {
  if (process.platform !== 'darwin') return Promise.resolve(undefined)
  const args = ['find-generic-password', '-s', input.service, '-a', input.account ?? userInfo().username, '-w']
  return new Promise(resolve => {
    execFile('/usr/bin/security', args, { timeout: 5_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
      const value = stdout.trim()
      resolve(error !== null || value.length === 0 ? undefined : value)
    })
  })
}
