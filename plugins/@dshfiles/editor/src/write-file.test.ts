import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sha256Hex, writeWorkspaceFile, type WorkspaceWriteRequest } from './write-file.js'

let sandbox: string
let root: string
let outside: string

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'dshfiles-editor-'))
  root = join(sandbox, 'workspace')
  outside = join(sandbox, 'outside')
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(outside)
})

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

const save = (overrides: Partial<WorkspaceWriteRequest> & Pick<WorkspaceWriteRequest, 'path'>) =>
  writeWorkspaceFile({ root, text: 'next\n', expectedSha256: null, overwrite: false, maxBytes: 1024, ...overrides })

const shaOf = (text: string): string => sha256Hex(Buffer.from(text, 'utf8'))

describe('writeWorkspaceFile', () => {
  it('creates a new file without leaving temp siblings', async () => {
    const result = await save({ path: 'src/new.ts' })
    expect(result).toMatchObject({ status: 'saved', sha256: shaOf('next\n'), bytes: 5 })
    expect(await readFile(join(root, 'src/new.ts'), 'utf8')).toBe('next\n')
    expect(await readdir(join(root, 'src'))).toEqual(['new.ts'])
  })

  it('replaces a file whose disk content still matches what the editor loaded, keeping its mode', async () => {
    const file = join(root, 'src/app.ts')
    await writeFile(file, 'before\n')
    await chmod(file, 0o600)
    const result = await save({ path: file, expectedSha256: shaOf('before\n') })
    expect(result.status).toBe('saved')
    expect(await readFile(file, 'utf8')).toBe('next\n')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('reports a conflict and leaves the file alone when it changed on disk', async () => {
    const file = join(root, 'src/app.ts')
    await writeFile(file, 'agent edit\n')
    expect(await save({ path: 'src/app.ts', expectedSha256: shaOf('before\n') })).toEqual({ status: 'conflict', currentSha256: shaOf('agent edit\n') })
    expect(await readFile(file, 'utf8')).toBe('agent edit\n')
  })

  it('reports a conflict when a file appeared where the editor expected none', async () => {
    await writeFile(join(root, 'src/app.ts'), 'created meanwhile\n')
    expect((await save({ path: 'src/app.ts' })).status).toBe('conflict')
  })

  it('overwrites a conflicting file once the user chose to', async () => {
    await writeFile(join(root, 'src/app.ts'), 'agent edit\n')
    expect((await save({ path: 'src/app.ts', expectedSha256: shaOf('before\n'), overwrite: true })).status).toBe('saved')
    expect(await readFile(join(root, 'src/app.ts'), 'utf8')).toBe('next\n')
  })

  it.each([['../outside/escape.txt'], ['src/../../outside/escape.txt']])('refuses relative traversal %s', async path => {
    await expect(save({ path })).rejects.toMatchObject({ code: 'outside-workspace' })
    expect(await readdir(outside)).toEqual([])
  })

  it('refuses an absolute path outside the workspace', async () => {
    await expect(save({ path: join(outside, 'escape.txt') })).rejects.toMatchObject({ code: 'outside-workspace' })
  })

  it('refuses a symlinked directory that leads outside the workspace', async () => {
    await symlink(outside, join(root, 'linked'))
    await expect(save({ path: 'linked/escape.txt' })).rejects.toMatchObject({ code: 'outside-workspace' })
    expect(await readdir(outside)).toEqual([])
  })

  it('refuses to replace a symlink even when it points inside the workspace', async () => {
    await writeFile(join(outside, 'secret.txt'), 'secret\n')
    await symlink(join(outside, 'secret.txt'), join(root, 'src/link.txt'))
    await expect(save({ path: 'src/link.txt', overwrite: true })).rejects.toMatchObject({ code: 'not-regular-file' })
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('secret\n')
  })

  it('refuses directories, missing parents, oversized content and version-control internals', async () => {
    await expect(save({ path: 'src', overwrite: true })).rejects.toMatchObject({ code: 'not-regular-file' })
    await expect(save({ path: 'missing/file.ts' })).rejects.toMatchObject({ code: 'missing-parent' })
    await expect(save({ path: 'src/big.txt', text: 'x'.repeat(1025) })).rejects.toMatchObject({ code: 'too-large' })
    await mkdir(join(root, '.git'))
    await expect(save({ path: '.git/config' })).rejects.toMatchObject({ code: 'protected-path' })
    await expect(save({ path: '.' })).rejects.toMatchObject({ code: 'outside-workspace' })
    await expect(save({ path: 'src/a\0b' })).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('accepts a root reached through a symlinked prefix', async () => {
    await symlink(root, join(sandbox, 'alias'))
    const result = await writeWorkspaceFile({
      root: join(sandbox, 'alias'),
      path: join(sandbox, 'alias/src/via-alias.ts'),
      text: 'ok',
      expectedSha256: null,
      overwrite: false,
      maxBytes: 1024,
    })
    expect(result.status).toBe('saved')
    expect(await readFile(join(root, 'src/via-alias.ts'), 'utf8')).toBe('ok')
  })
})
