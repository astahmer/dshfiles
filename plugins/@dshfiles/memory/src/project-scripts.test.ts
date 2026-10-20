import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ProjectScripts } from './project-scripts.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const scratch = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'project-scripts-'))
  directories.push(directory)
  return directory
}

it('writes a project its scripts once, keeps a hand edit, and cleans a workspace but never the checkout itself', async () => {
  const base = scratch()
  const project = join(base, 'project')
  const workspace = join(base, 'project-threads', 'thread-abc123')
  mkdirSync(join(project, 'node_modules', 'left-alone'), { recursive: true })
  mkdirSync(join(workspace, 'node_modules', 'pkg'), { recursive: true })
  mkdirSync(join(workspace, 'packages', 'app', 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(workspace, 'packages', 'app', 'index.ts'), 'kept\n')
  writeFileSync(join(project, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  const root = join(base, 'scripts')

  const scripts = await ProjectScripts.ensure({ root, project })
  if (scripts === null) throw new Error('expected scripts for a pnpm project')
  expect(readFileSync(scripts.setup, 'utf8')).toContain('pnpm install --frozen-lockfile --prefer-offline')
  writeFileSync(scripts.setup, '#!/bin/sh\necho edited\n')
  await ProjectScripts.ensure({ root, project })
  expect(readFileSync(scripts.setup, 'utf8')).toBe('#!/bin/sh\necho edited\n')

  expect(spawnSync(scripts.cleanup, [workspace]).status).toBe(0)
  expect(existsSync(join(workspace, 'node_modules'))).toBe(false)
  expect(existsSync(join(workspace, 'packages', 'app', 'node_modules'))).toBe(false)
  expect(existsSync(join(workspace, 'packages', 'app', 'index.ts'))).toBe(true)

  expect(spawnSync(scripts.cleanup, [project]).status).toBe(1)
  expect(existsSync(join(project, 'node_modules', 'left-alone'))).toBe(true)
})

it('writes nothing for a project without a lockfile', async () => {
  const base = scratch()
  await expect(ProjectScripts.ensure({ root: join(base, 'scripts'), project: base })).resolves.toBeNull()
  expect(existsSync(join(base, 'scripts'))).toBe(false)
})
