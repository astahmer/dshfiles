import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createLocalProjectCopyCommand } from './local-project-copy-command.js'

let temporaryPath: string | undefined

afterEach(() => {
  if (temporaryPath === undefined) return
  rmSync(temporaryPath, { recursive: true, force: true })
  temporaryPath = undefined
})

test('extracts selected files but refuses symlinked destination folders', () => {
  temporaryPath = mkdtempSync(join(tmpdir(), 'multi-host-copy-command-'))
  const source = join(temporaryPath, 'source')
  const safeDestination = join(temporaryPath, 'safe-destination')
  const unsafeDestination = join(temporaryPath, 'unsafe-destination')
  const outside = join(temporaryPath, 'outside')
  mkdirSync(join(source, 'safe'), { recursive: true })
  mkdirSync(safeDestination)
  mkdirSync(unsafeDestination)
  mkdirSync(outside)
  writeFileSync(join(source, 'safe', 'payload.txt'), 'synthetic')
  writeFileSync(join(source, 'linked.txt'), 'synthetic link target')
  symlinkSync(outside, join(unsafeDestination, 'safe'))
  symlinkSync(join(outside, 'linked.txt'), join(unsafeDestination, 'linked.txt'))
  const archive = execFileSync('tar', ['-cf', '-', '-C', source, 'safe/payload.txt'])
  const linkedArchive = execFileSync('tar', ['-cf', '-', '-C', source, 'linked.txt'])

  const safeResult = spawnSync('sh', ['-c', createLocalProjectCopyCommand({ destinationPath: safeDestination, paths: ['safe/payload.txt'] })], {
    input: archive,
    encoding: 'utf8',
  })
  expect(safeResult.status).toBe(0)
  expect(readFileSync(join(safeDestination, 'safe', 'payload.txt'), 'utf8')).toBe('synthetic')

  const unsafeResult = spawnSync('sh', ['-c', createLocalProjectCopyCommand({ destinationPath: unsafeDestination, paths: ['safe/payload.txt'] })], {
    input: archive,
    encoding: 'utf8',
  })
  expect(unsafeResult.status).toBe(73)
  expect(unsafeResult.stderr).toContain('Refusing local file copy through a symlinked project path.')
  expect(existsSync(join(outside, 'payload.txt'))).toBe(false)

  const linkedResult = spawnSync('sh', ['-c', createLocalProjectCopyCommand({ destinationPath: unsafeDestination, paths: ['linked.txt'] })], {
    input: linkedArchive,
    encoding: 'utf8',
  })
  expect(linkedResult.status).toBe(73)
  expect(existsSync(join(outside, 'linked.txt'))).toBe(false)
})
