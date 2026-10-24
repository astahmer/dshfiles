import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAccountLoginService } from './account-login-service.js'
import { codexLoginFiles, createCodexLoginFiles } from './codex-login-files.js'
import type { CodexHomeLayout } from './codex-home.js'

let root = ''
let target: CodexHomeLayout
const fakeAuth = JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'fixture-only-access', refresh_token: 'fixture-only-refresh' } })
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-managed-login-')))
  const home = join(root, 'homes', 'codex_work_12345678123442348234123456789abc')
  target = { mode: 'direct', sharedHomePath: home, effectiveHomePath: home }
  await mkdir(join(root, 'homes'))
})
afterEach(async () => {
  const prefix = join(await realpath(tmpdir()), 'dsh-managed-login-')
  if (resolve(root) !== root || !root.startsWith(prefix)) throw new Error('Unexpected managed-home fixture cleanup path')
  await rm(root, { recursive: true, force: true })
})
const filesForTarget = () => createCodexLoginFiles(path => path === target.sharedHomePath)

describe('trusted managed direct Codex homes outside the global user home', () => {
  it('runs the complete service against fresh private staging and adopts CLI-owned auth in the managed target', async () => {
    const files = filesForTarget()
    const run = vi.fn(async (input: { home: string }) => {
      expect(input.home).not.toBe(target.effectiveHomePath)
      expect(input.home).toMatch(/\/\.dsh-login-[A-Za-z0-9]{6}$/u)
      expect((await lstat(input.home)).mode & 0o777).toBe(0o700)
      expect(await readdir(input.home)).toEqual([])
      await writeFile(join(input.home, 'auth.json'), fakeAuth, { mode: 0o600 })
      return 0
    })
    const onComplete = vi.fn(async () => {})
    const service = createAccountLoginService({ account: async () => ({ instanceId: 'work', kind: 'codex', layout: target }), files, run, onComplete })
    try {
      await service.begin('work')
      await service.settled()
      expect(service.state('work').status).toBe('complete')
      expect(run).toHaveBeenCalledOnce()
      expect(onComplete).toHaveBeenCalledOnce()
      expect(await readFile(join(target.effectiveHomePath, 'auth.json'), 'utf8')).toBe(fakeAuth)
      expect(await readdir(target.effectiveHomePath)).toEqual(['auth.json'])
    } finally {
      service.dispose()
      await service.settled()
    }
  })
  it('does not admit any direct home without the Host policy', async () => {
    await expect(codexLoginFiles.prepare(target)).rejects.toThrow('trusted Host-managed')
  })
  it('accepts only the exact canonical managed target, not near matches or traversal aliases', async () => {
    const files = filesForTarget()
    for (const path of [
      `${target.effectiveHomePath}_other`,
      `${target.effectiveHomePath}/../${target.effectiveHomePath.split('/').at(-1)}`,
      `${target.effectiveHomePath}/.`,
      `${target.effectiveHomePath}/child`,
      join(root, 'other-store', 'homes', target.effectiveHomePath.split('/').at(-1) ?? ''),
    ])
      await expect(files.prepare({ mode: 'direct', sharedHomePath: path, effectiveHomePath: path })).rejects.toThrow()
  })
  it('admits only a strict immediate staging child of the managed target and never recursively stages it', async () => {
    const files = filesForTarget()
    await files.prepare(target)
    const stage = await files.stage(target)
    expect((await files.auth(stage)).fingerprint).toBeNull()
    await expect(files.prepare(stage)).rejects.toThrow('managed account target')
    await expect(files.stage(stage)).rejects.toThrow('managed account target')
    for (const name of ['.dsh-login-', '.dsh-login-ABC1234', '.dsh-login-ABC_12', '.dsh-login-ABC123/child', 'other/.dsh-login-ABC123']) {
      await expect(files.auth({ ...target, effectiveHomePath: `${target.effectiveHomePath}/${name}` })).rejects.toThrow()
    }
    await expect(files.auth({ ...target, effectiveHomePath: `${target.effectiveHomePath}/child/../.dsh-login-ABC123` })).rejects.toThrow()
    await expect(files.cleanup(target)).rejects.toThrow('cleanup path')
    await files.cleanup(stage)
  })
  it('refuses symlinked managed target ancestors even when the Host recognizes the lexical path', async () => {
    await mkdir(join(root, 'elsewhere'))
    await symlink(join(root, 'elsewhere'), target.effectiveHomePath)
    await expect(filesForTarget().prepare(target)).rejects.toThrow('Unsafe Codex login home')
  })
  it('refuses linked or non-private staged credentials and preserves existing target auth', async () => {
    const files = filesForTarget()
    await files.prepare(target)
    await writeFile(join(target.effectiveHomePath, 'auth.json'), fakeAuth, { mode: 0o600 })
    const before = await files.auth(target)
    const stage = await files.stage(target)
    const auth = join(stage.effectiveHomePath, 'auth.json')
    await writeFile(auth, fakeAuth, { mode: 0o600 })
    await chmod(auth, 0o644)
    expect(() => files.adopt(stage, target, before.fingerprint)).toThrow('private')
    if (resolve(auth) !== auth || !auth.startsWith(`${target.effectiveHomePath}/.dsh-login-`) || !auth.endsWith('/auth.json'))
      throw new Error('Unexpected staged fixture auth path')
    await rm(auth)
    await symlink(join(target.effectiveHomePath, 'auth.json'), auth)
    expect(() => files.adopt(stage, target, before.fingerprint)).toThrow()
    expect(await readFile(join(target.effectiveHomePath, 'auth.json'), 'utf8')).toBe(fakeAuth)
  })
  it('does not exempt legacy auth-overlay layouts from global home containment even with a permissive managed policy', async () => {
    const files = createCodexLoginFiles(() => true)
    await expect(files.prepare({ mode: 'authOverlay', sharedHomePath: join(root, 'shared'), effectiveHomePath: join(root, 'shadow') })).rejects.toThrow()
  })
})
