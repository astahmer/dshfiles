import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { materializeCodexShadowHome, type CodexHomeLayout } from './codex-home.js'
import { AccountSessionFilePolicy, createAccountSessionFiles } from './account-session-service.js'

let root = ''
let layout: CodexHomeLayout
const fakeShared = 'synthetic-shared-credential-not-real'
beforeEach(async () => {
  root = await mkdtemp(join(userInfo().homedir, '.dsh-session-files-test-'))
  layout = { mode: 'authOverlay', sharedHomePath: join(root, 'shared'), effectiveHomePath: join(root, 'private') }
  await mkdir(layout.sharedHomePath)
  await mkdir(layout.effectiveHomePath)
  await writeFile(join(layout.sharedHomePath, 'auth.json'), fakeShared, { mode: 0o600 })
})
afterEach(async () => {
  if (resolve(root) !== root || !root.startsWith(join(userInfo().homedir, '.dsh-session-files-test-')))
    throw new Error('Unexpected synthetic fixture cleanup target')
  await rm(root, { recursive: true, force: true })
})
describe('real filesystem boundary with synthetic credentials only', () => {
  it('requires the actual Host uid and rejects another-owner or other-user-writable metadata without chown', () => {
    const uid = process.getuid?.()
    if (uid === undefined) throw new Error('This POSIX safety regression requires a Host uid')
    expect(() => AccountSessionFilePolicy.assertOwned({ uid, mode: 0o40755 })).not.toThrow()
    expect(() => AccountSessionFilePolicy.assertOwned({ uid: uid + 1, mode: 0o40700 })).toThrow()
    expect(() => AccountSessionFilePolicy.assertOwned({ uid, mode: 0o40720 })).toThrow()
  })
  it('refuses unsafe writable ancestors and a writable Claude credential file without mutating either', async () => {
    await chmod(root, 0o777)
    await expect(createAccountSessionFiles().validateClaude(layout.effectiveHomePath)).rejects.toThrow()
    await chmod(root, 0o700)
    const credential = join(layout.effectiveHomePath, '.credentials.json')
    await writeFile(credential, 'synthetic-credential', { mode: 0o600 })
    await chmod(credential, 0o666)
    await expect(createAccountSessionFiles().validateClaude(layout.effectiveHomePath)).rejects.toThrow()
    expect(await readFile(credential, 'utf8')).toBe('synthetic-credential')
  })
  it('leaves a 0600 private tombstone so the existing materializer cannot silently copy the shared login back', async () => {
    const files = createAccountSessionFiles()
    await files.validateCodex(layout)
    await files.finishCodexLogout(layout)
    const target = join(layout.effectiveHomePath, 'auth.json')
    expect(await readFile(target, 'utf8')).toBe('{}\n')
    expect((await lstat(target)).mode & 0o777).toBe(0o600)
    await materializeCodexShadowHome(layout)
    expect(await readFile(target, 'utf8')).toBe('{}\n')
    expect(await readFile(join(layout.sharedHomePath, 'auth.json'), 'utf8')).toBe(fakeShared)
  })
  it('does not overwrite an auth file concurrently saved after CLI logout', async () => {
    const target = join(layout.effectiveHomePath, 'auth.json')
    await writeFile(target, 'synthetic-newer-login', { mode: 0o600 })
    await expect(createAccountSessionFiles().finishCodexLogout(layout)).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe('synthetic-newer-login')
    expect(await readFile(join(layout.sharedHomePath, 'auth.json'), 'utf8')).toBe(fakeShared)
  })
  it.each(['symlink', 'hardlink', 'directory'] as const)('refuses a %s auth file before any logout mutation', async kind => {
    const target = join(layout.effectiveHomePath, 'auth.json')
    const source = join(layout.sharedHomePath, 'auth.json')
    if (kind === 'symlink') await symlink(source, target)
    else if (kind === 'hardlink') await link(source, target)
    else await mkdir(target)
    await expect(createAccountSessionFiles().validateCodex(layout)).rejects.toThrow()
    await expect(createAccountSessionFiles().finishCodexLogout(layout)).rejects.toThrow()
    expect(await readFile(source, 'utf8')).toBe(fakeShared)
  })
  it('refuses a group/world-writable selected home without touching its contents', async () => {
    await chmod(layout.effectiveHomePath, 0o777)
    const files = createAccountSessionFiles()
    await expect(files.validateCodex(layout)).rejects.toThrow()
    await expect(files.validateClaude(layout.effectiveHomePath)).rejects.toThrow()
    await expect(files.finishCodexLogout(layout)).rejects.toThrow()
    expect(await readFile(join(layout.sharedHomePath, 'auth.json'), 'utf8')).toBe(fakeShared)
  })
  it.each(['symlink', 'hardlink'] as const)('refuses a %s Claude configuration file before logout', async kind => {
    const source = join(layout.sharedHomePath, 'auth.json')
    const target = join(layout.effectiveHomePath, '.claude.json')
    if (kind === 'symlink') await symlink(source, target)
    else await link(source, target)
    await expect(createAccountSessionFiles().validateClaude(layout.effectiveHomePath)).rejects.toThrow()
    expect(await readFile(source, 'utf8')).toBe(fakeShared)
  })
  it('refuses an unowned direct/shared layout and symlinked directory ancestors', async () => {
    const files = createAccountSessionFiles()
    await expect(files.validateCodex({ ...layout, mode: 'direct', effectiveHomePath: layout.sharedHomePath })).rejects.toThrow()
    const alias = join(root, 'alias')
    await symlink(layout.effectiveHomePath, alias)
    await expect(files.validateCodex({ ...layout, effectiveHomePath: alias })).rejects.toThrow()
    await expect(files.validateClaude(alias)).rejects.toThrow()
  })
})
