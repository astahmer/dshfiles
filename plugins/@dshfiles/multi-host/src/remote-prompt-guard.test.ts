import { describe, expect, test } from 'vitest'
import { RemotePromptGuard } from './remote-prompt-guard.js'

const refused = (text: string, cwd: string | undefined = '/home/remote/project', localHome = '/Users/me') =>
  RemotePromptGuard.localMention({ text, cwd, localHome })

describe('local path rule on a remote thread', () => {
  test.each([
    ['a mention under this machine home', 'read @/Users/me/notes.md please', '/Users/me/notes.md'],
    ['the home itself', '@/Users/me', '/Users/me'],
    ['a tilde path', 'look at @~/notes.md', '~/notes.md'],
    ['a bare tilde', '@~', '~'],
    ['a quoted path with spaces', 'see @"/Users/me/my notes.md" now', '/Users/me/my notes.md'],
    ['an open quoted directory', '@"/Users/me/my dir/', '/Users/me/my dir/'],
    ['a traversal back into the home', '@/tmp/../Users/me/notes.md', '/tmp/../Users/me/notes.md'],
  ])('refuses %s', (_name, text, mention) => {
    expect(refused(text)).toBe(mention)
  })

  test.each([
    ['a relative mention', '@src/app.ts'],
    ['a path inside the thread folder', '@/home/remote/project/x.ts'],
    ['the remote elsewhere', '@/etc/hosts'],
    ['a local path outside the home', '@/opt/local/x'],
    ['prose naming a home path', 'see /Users/me/notes.md for the trace'],
    ['an email-like token', 'mail me@/Users/me/notes.md'],
    ['a sibling of the home', '@/Users/medium/notes.md'],
    ['a thread mention', '@t:session-1'],
  ])('sends %s', (_name, text) => {
    expect(refused(text)).toBeUndefined()
  })

  test('a thread folder under a shared home path wins over the home', () => {
    expect(refused('@/home/me/project/x.ts', '/home/me/project', '/home/me')).toBeUndefined()
    expect(refused('@/home/me/other/x.ts', '/home/me/project', '/home/me')).toBe('/home/me/other/x.ts')
  })

  test('an unknown thread folder still refuses the home', () => {
    expect(refused('@/Users/me/notes.md', undefined)).toBe('/Users/me/notes.md')
  })

  test('the refusal names the host and says how to recover', () => {
    const message = RemotePromptGuard.localPathRefusal({ text: '@/Users/me/notes.md', localHome: '/Users/me', cwd: undefined, hostName: 'build box' })
    expect(message).toContain('@/Users/me/notes.md')
    expect(message).toContain('build box')
    expect(message).toContain('Attach the file')
  })
})

describe('upload receipts on a remote thread', () => {
  const staged = new Map([['receipt-a', { runtimeId: 'runtime-a', sessionId: 'session-a' }]])
  const refusal = (receiptIds: readonly string[], runtimeId: string, sessionId: string) =>
    RemotePromptGuard.foreignUploadRefusal({ receiptIds, staged, runtimeId, sessionId, hostName: 'build box' })

  test('a receipt of this thread passes', () => {
    expect(refusal(['receipt-a'], 'runtime-a', 'session-a')).toBeUndefined()
  })

  test('a receipt of another runtime or thread is refused before it is sent', () => {
    expect(refusal(['receipt-a'], 'runtime-b', 'session-a')).toContain('attach the file again')
    expect(refusal(['receipt-a'], 'runtime-a', 'session-b')).toContain('attach the file again')
  })

  test('an unknown receipt is left to the owning runtime, which decides after a local restart', () => {
    expect(refusal(['receipt-unknown'], 'runtime-a', 'session-a')).toBeUndefined()
  })
})
