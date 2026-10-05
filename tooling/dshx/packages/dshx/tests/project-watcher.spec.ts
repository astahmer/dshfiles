import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { watchProjectFiles } from '../src/dev/project-watcher.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

it('watches exact project files, ignores initial state, and tolerates missing parent directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dshx-project-watcher-'))
  temporaryDirectories.push(directory)
  const target = resolve(directory, 'package.json')
  const missingTarget = resolve(directory, 'missing', 'dshx.config.ts')
  await writeFile(target, '{}\n')

  const changedFiles: string[] = []
  const watcher = await watchProjectFiles([target, missingTarget, target], file => changedFiles.push(file))
  try {
    expect(changedFiles).toEqual([])

    await writeFile(target, '{"name":"updated"}\n')
    await vi.waitFor(() => expect(changedFiles).toEqual([target]))

    await rm(target)
    await vi.waitFor(() => expect(changedFiles).toEqual([target, target]))
  } finally {
    await watcher.close()
  }
})
