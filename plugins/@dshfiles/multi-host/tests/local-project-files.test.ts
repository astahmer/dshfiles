import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, test } from 'vitest'
import { LocalProjectFiles } from '../src/local-project-files.js'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const makeGitProject = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'multi-host-local-copy-'))
  temporaryPaths.push(root)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Multi-host test'], { cwd: root })
  await writeFile(join(root, '.gitignore'), 'local-secret.env\n.env.local\nignored-settings.json\nnode_modules/\n!.env.example\n')
  await writeFile(join(root, 'tracked.txt'), 'tracked')
  execFileSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: root })
  execFileSync('git', ['commit', '--quiet', '-m', 'test fixture'], { cwd: root })
  await writeFile(join(root, 'local-secret.env'), 'not emitted in test output')
  await writeFile(join(root, '.env.local'), 'not emitted in test output')
  await writeFile(join(root, 'ignored-settings.json'), 'explicitly selected ignored settings')
  await writeFile(join(root, '.env.example'), 'example only')
  await writeFile(join(root, 'notes with spaces.txt'), 'local note')
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'not copied')
  return root
}

const services = Layer.mergeAll(NodeServices.layer, tracerLayer)

const scan = (input: { readonly path: string; readonly includeIgnored?: boolean }) =>
  LocalProjectFiles.list(input).pipe(Effect.provide(services), Effect.runPromise)

const archive = (input: { readonly root: string; readonly paths: readonly string[]; readonly includeIgnored?: boolean }) =>
  LocalProjectFiles.archive(input).pipe(Effect.provide(services), Effect.runPromise)

describe('local project copy', () => {
  test(
    'scans untracked files by default, explicitly includes ignored files, blocks credential-like paths, and archives only selected files',
    { timeout: 30_000 },
    async () => {
      const root = await makeGitProject()
      using recorder = recordSpans()
      const found = await scan({ path: root })
      expect(found.files.map(file => ({ path: file.path, ignored: file.ignored, copyable: file.copyable }))).toEqual([
        { path: '.env.example', ignored: false, copyable: true },
        { path: 'notes with spaces.txt', ignored: false, copyable: true },
      ])
      const ignoredScan = await scan({ path: root, includeIgnored: true })
      expect(ignoredScan.files.map(file => ({ path: file.path, ignored: file.ignored, copyable: file.copyable, copyReason: file.copyReason }))).toEqual([
        { path: '.env.example', ignored: false, copyable: true, copyReason: undefined },
        { path: '.env.local', ignored: true, copyable: false, copyReason: 'potential-secret' },
        { path: 'ignored-settings.json', ignored: true, copyable: true, copyReason: undefined },
        { path: 'local-secret.env', ignored: true, copyable: false, copyReason: 'potential-secret' },
        { path: 'notes with spaces.txt', ignored: false, copyable: true, copyReason: undefined },
      ])
      expect(recorder.span('local project files scan').attributes).toMatchObject({ 'dshfiles.multi_host.local_file_count': 2 })
      const tar = await archive({ root: found.root, paths: ['notes with spaces.txt'] })
      expect(recorder.span('local project files archive').attributes).toMatchObject({
        'dshfiles.multi_host.local_file_count': 1,
        'dshfiles.multi_host.local_file_bytes': 10,
      })
      expect(execFileSync('tar', ['-tf', '-'], { input: tar, encoding: 'utf8' }).trim()).toBe('notes with spaces.txt')
    },
  )

  test('refuses credentials, files outside the project and paths outside a Git project', { timeout: 30_000 }, async () => {
    const root = await makeGitProject()
    const found = await scan({ path: root, includeIgnored: true })
    await expect(archive({ root: found.root, paths: ['ignored-settings.json'] })).rejects.toThrow()
    await expect(archive({ root: found.root, paths: ['local-secret.env'], includeIgnored: true })).rejects.toThrow()
    const notGit = await mkdtemp(join(tmpdir(), 'multi-host-not-git-'))
    temporaryPaths.push(notGit)
    await expect(scan({ path: notGit })).rejects.toThrow()
    await expect(archive({ root: notGit, paths: ['../outside'] })).rejects.toThrow()
  })
})
