import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterEach, describe, expect, test } from 'vitest'
import { createLocalProjectArchive, listLocalProjectFiles } from './local-project-files.js'

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
  await writeFile(join(root, '.gitignore'), 'local-secret.env\nnode_modules/\n')
  await writeFile(join(root, 'tracked.txt'), 'tracked')
  execFileSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: root })
  execFileSync('git', ['commit', '--quiet', '-m', 'test fixture'], { cwd: root })
  await writeFile(join(root, 'local-secret.env'), 'not emitted in test output')
  await writeFile(join(root, 'notes with spaces.txt'), 'local note')
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'not copied')
  return root
}

describe('local project copy', () => {
  test('lists ignored and untracked files, filters dependencies, and archives only selected paths', async () => {
    const root = await makeGitProject()
    using recorder = recordSpans()
    const scan = await listLocalProjectFiles({ path: root })
    expect(scan.files.map(file => ({ path: file.path, ignored: file.ignored }))).toEqual([
      { path: 'local-secret.env', ignored: true },
      { path: 'notes with spaces.txt', ignored: false },
    ])
    const scanSpan = recorder.span('local project files scan')
    expect(scanSpan.kind).toBe('internal')
    expect(scanSpan.attributes).toMatchObject({ 'dshfiles.multi_host.local_file_count': 2 })
    const archive = await createLocalProjectArchive({ root: scan.root, paths: ['notes with spaces.txt'] })
    const archiveSpan = recorder.span('local project files archive')
    expect(archiveSpan.kind).toBe('internal')
    expect(archiveSpan.attributes).toMatchObject({ 'dshfiles.multi_host.local_file_count': 1, 'dshfiles.multi_host.local_file_bytes': 10 })
    expect(JSON.stringify({ scan: scanSpan.attributes, archive: archiveSpan.attributes })).not.toMatch(/local-secret\.env|notes with spaces\.txt|local note/u)
    const contents = execFileSync('tar', ['-tf', '-'], { input: archive, encoding: 'utf8' })
    expect(contents.trim()).toBe('notes with spaces.txt')
    const extracted = join(root, 'extracted')
    await mkdir(extracted)
    execFileSync('tar', ['-xkf', '-', '-C', extracted], { input: archive })
    expect(await readFile(join(extracted, 'notes with spaces.txt'), 'utf8')).toBe('local note')
    const destination = join(root, 'destination')
    await mkdir(destination)
    await writeFile(join(destination, 'notes with spaces.txt'), 'existing remote file')
    try {
      execFileSync('tar', ['-xkf', '-', '-C', destination], { input: archive, stdio: ['ignore', 'ignore', 'ignore'] })
    } catch {}
    expect(await readFile(join(destination, 'notes with spaces.txt'), 'utf8')).toBe('existing remote file')
  })

  test('rejects paths outside a Git project and path traversal in the archive list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'multi-host-not-git-'))
    temporaryPaths.push(root)
    await expect(listLocalProjectFiles({ path: root })).rejects.toMatchObject({ code: 'not-a-git-project' })
    await expect(createLocalProjectArchive({ root, paths: ['../outside'] })).rejects.toMatchObject({ code: 'invalid-file-path' })
  })
})
