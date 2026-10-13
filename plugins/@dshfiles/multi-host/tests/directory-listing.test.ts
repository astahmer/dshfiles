import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createChildDirectory, listDirectory } from '../src/directory-listing.js'

describe('runtime folder listing', () => {
  test('lists folders and folder symlinks, hidden ones last, with crumbs; files are left out', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'multi-host-folders-')))
    try {
      await mkdir(join(root, 'beta'))
      await mkdir(join(root, 'alpha'))
      await mkdir(join(root, '.cache'))
      await writeFile(join(root, 'notes.txt'), 'x')
      await symlink(join(root, 'alpha'), join(root, 'linked'))
      const listing = await listDirectory(root)
      expect(listing.entries.map(entry => [entry.name, entry.hidden])).toEqual([
        ['alpha', false],
        ['beta', false],
        ['linked', false],
        ['.cache', true],
      ])
      expect(listing.crumbs.at(-1)?.path).toBe(root)
      await expect(listDirectory('relative/path')).rejects.toThrow('absolute')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('creates one child folder and refuses nested or empty names', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'multi-host-folders-')))
    try {
      expect(await createChildDirectory({ path: root, name: 'project' })).toBe(join(root, 'project'))
      await expect(createChildDirectory({ path: root, name: '../escape' })).rejects.toThrow()
      await expect(createChildDirectory({ path: root, name: ' ' })).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
