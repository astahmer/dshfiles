import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'
import { commandAttributes, withSpan } from '@dshfiles/dshx/tracing'

/**
 * Read one generic-password item from the macOS login keychain, the store
 * Claude Code and Cursor CLI use for their logins. Fixed arguments only, never
 * a shell; any failure (no item, another platform, a denied prompt) reads as
 * absent so the caller reports "not signed in" rather than an error.
 */
export const readKeychainSecret = (input: { readonly service: string; readonly account?: string }): Promise<string | undefined> => {
  if (process.platform !== 'darwin') return Promise.resolve(undefined)
  const args = ['find-generic-password', '-s', input.service, '-a', input.account ?? userInfo().username, '-w']
  return withSpan(
    'keychain read',
    { kind: 'client', attributes: commandAttributes({ executable: 'security', args, valueFlags: ['-s', '-a'] }) },
    async span => {
      const value = await new Promise<string | undefined>(resolve => {
        execFile('/usr/bin/security', args, { timeout: 5_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
          const output = stdout.trim()
          resolve(error !== null || output.length === 0 ? undefined : output)
        })
      })
      span.setAttribute('dshx.ai-accounts.found', value !== undefined)
      return value
    },
  )
}
