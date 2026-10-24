import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codexLoginFiles } from './codex-login-files.js'
import type { CodexHomeLayout } from './codex-home.js'

let root = ''
let layout: CodexHomeLayout
const fakeAuth = JSON.stringify({
  auth_mode: 'chatgpt',
  tokens: { access_token: 'fixture-not-a-real-access-token', refresh_token: 'fixture-not-a-real-refresh-token' },
})
beforeEach(async () => {
  root = await mkdtemp(join(userInfo().homedir, '.dsh-login-files-test-'))
  layout = { mode: 'authOverlay', sharedHomePath: join(root, 'shared'), effectiveHomePath: join(root, 'shadow') }
  await mkdir(layout.sharedHomePath)
})
afterEach(async () => {
  // Verify the absolute fixture target before removing it, never compute from an unset home.
  if (resolve(root) !== root || !root.startsWith(join(userInfo().homedir, '.dsh-login-files-test-'))) throw new Error('Unexpected fixture cleanup path')
  await rm(root, { recursive: true, force: true })
})

describe('private CLI-owned auth staging filesystem adapter', () => {
  it('never seeds or mutates shared/existing target auth; adopts the CLI file only after validation', async () => {
    await writeFile(join(layout.sharedHomePath, 'auth.json'), 'shared-fixture-never-read')
    await codexLoginFiles.prepare(layout)
    expect(await readdir(layout.effectiveHomePath)).toEqual([])
    expect((await lstat(layout.effectiveHomePath)).mode & 0o777).toBe(0o700)
    const before = await codexLoginFiles.auth(layout)
    const stage = await codexLoginFiles.stage(layout)
    expect(await readdir(stage.effectiveHomePath)).toEqual([])
    expect((await lstat(stage.effectiveHomePath)).mode & 0o777).toBe(0o700)
    await writeFile(join(stage.effectiveHomePath, 'auth.json'), fakeAuth, { mode: 0o600 })
    expect(await codexLoginFiles.auth(stage)).toMatchObject({ signedIn: true, hasCredential: true })
    expect(codexLoginFiles.adopt(stage, layout, before.fingerprint)).toBe(true)
    expect(await readFile(join(layout.effectiveHomePath, 'auth.json'), 'utf8')).toBe(fakeAuth)
    expect(await readFile(join(layout.sharedHomePath, 'auth.json'), 'utf8')).toBe('shared-fixture-never-read')
    await codexLoginFiles.cleanup(stage)
    expect(await readdir(layout.effectiveHomePath)).toEqual(['auth.json'])
  })
  it('preserves a concurrent target writer and refuses to overwrite it', async () => {
    await codexLoginFiles.prepare(layout)
    const before = await codexLoginFiles.auth(layout)
    const stage = await codexLoginFiles.stage(layout)
    await writeFile(join(stage.effectiveHomePath, 'auth.json'), fakeAuth, { mode: 0o600 })
    await writeFile(join(layout.effectiveHomePath, 'auth.json'), 'newer-fixture-credential')
    expect(codexLoginFiles.adopt(stage, layout, before.fingerprint)).toBe(false)
    expect(await readFile(join(layout.effectiveHomePath, 'auth.json'), 'utf8')).toBe('newer-fixture-credential')
    await codexLoginFiles.cleanup(stage)
  })
  it('cleanup of cancelled staging leaves existing target credentials byte-for-byte unchanged', async () => {
    await codexLoginFiles.prepare(layout)
    await writeFile(join(layout.effectiveHomePath, 'auth.json'), fakeAuth, { mode: 0o600 })
    const stage = await codexLoginFiles.stage(layout)
    await writeFile(join(stage.effectiveHomePath, 'auth.json'), 'cancelled-fixture')
    await codexLoginFiles.cleanup(stage)
    expect(await readFile(join(layout.effectiveHomePath, 'auth.json'), 'utf8')).toBe(fakeAuth)
  })
  it.each(['symlink', 'hardlink', 'directory'])('refuses %s auth before spawning', async kind => {
    await mkdir(layout.effectiveHomePath)
    const source = join(layout.sharedHomePath, 'auth.json')
    const target = join(layout.effectiveHomePath, 'auth.json')
    await writeFile(source, fakeAuth, { mode: 0o600 })
    if (kind === 'symlink') await symlink(source, target)
    else if (kind === 'hardlink') await link(source, target)
    else await mkdir(target)
    await expect(codexLoginFiles.prepare(layout)).rejects.toThrow()
    expect(await readFile(source, 'utf8')).toBe(fakeAuth)
  })
  it('refuses symlinked shadow ancestors and direct/shared-home login', async () => {
    await symlink(layout.sharedHomePath, layout.effectiveHomePath)
    await expect(codexLoginFiles.prepare(layout)).rejects.toThrow()
    await expect(codexLoginFiles.prepare({ ...layout, mode: 'direct', effectiveHomePath: layout.sharedHomePath })).rejects.toThrow()
  })
  it('bounds auth reads and accepts only a ChatGPT token pair, not empty/API-key/malformed files', async () => {
    await codexLoginFiles.prepare(layout)
    for (const text of ['{}', '{malformed', JSON.stringify({ OPENAI_API_KEY: 'fixture-not-real' }), JSON.stringify({ tokens: { access_token: 'fixture' } })]) {
      await writeFile(join(layout.effectiveHomePath, 'auth.json'), text)
      expect((await codexLoginFiles.auth(layout)).signedIn).toBe(false)
    }
    await writeFile(join(layout.effectiveHomePath, 'auth.json'), '{}')
    expect((await codexLoginFiles.auth(layout)).hasCredential).toBe(false)
    await writeFile(join(layout.effectiveHomePath, 'auth.json'), 'x'.repeat(65537))
    await expect(codexLoginFiles.auth(layout)).rejects.toThrow('Unsafe Codex auth file')
  })
  it('refuses an auth symlink swapped in before adoption and non-private staged auth', async () => {
    await codexLoginFiles.prepare(layout)
    const stage = await codexLoginFiles.stage(layout)
    await writeFile(join(stage.effectiveHomePath, 'auth.json'), fakeAuth, { mode: 0o600 })
    await chmod(join(stage.effectiveHomePath, 'auth.json'), 0o644)
    expect(() => codexLoginFiles.adopt(stage, layout, null)).toThrow('private')
    await symlink(join(stage.effectiveHomePath, 'auth.json'), join(layout.effectiveHomePath, 'auth.json'))
    expect(() => codexLoginFiles.adopt(stage, layout, null)).toThrow()
  })
})
