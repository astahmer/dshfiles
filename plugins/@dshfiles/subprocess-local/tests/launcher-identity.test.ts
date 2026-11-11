import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { memoizedSystemdRunIdentity } from '../src/native/linux-scope.ts'

const originalPath = process.env.PATH
const directories: string[] = []

afterEach(() => {
  process.env.PATH = originalPath
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const launcherDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'systemd-run-'))
  directories.push(directory)
  writeFileSync(join(directory, 'systemd-run'), '#!/bin/sh\n')
  return directory
}

it('stats PATH for systemd-run once per PATH value instead of once per launch', () => {
  const first = launcherDirectory()
  process.env.PATH = first
  const identity = memoizedSystemdRunIdentity()
  const initial = identity()
  expect(initial).toBeDefined()
  appendFileSync(join(first, 'systemd-run'), 'exit 0\n')
  expect(identity()).toBe(initial)
  const second = launcherDirectory()
  appendFileSync(join(second, 'systemd-run'), 'exit 1\n# another build\n')
  process.env.PATH = second
  expect(identity()).not.toBe(initial)
})
