import { mkdir, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, sep } from 'node:path'
import type { DirectoryListing } from './api.js'

const maxEntries = 2_000

/**
 * One folder level of this machine for a remote folder picker. Stock DSH only serves `directoryPicker.list` where the
 * composition has an in-app browser; a headless Linux runtime composes the native chooser and refuses it.
 */
export const listDirectory = async (requested: string | undefined): Promise<DirectoryListing> => {
  const home = homedir()
  if (requested !== undefined && !isAbsolute(requested)) throw new Error('Folder paths must be absolute.')
  const path = await realpath(requested ?? home)
  const children = await readdir(path, { withFileTypes: true })
  const entries: DirectoryListing['entries'] = []
  for (const child of children) {
    const childPath = join(path, child.name)
    const isDirectory =
      child.isDirectory() ||
      (child.isSymbolicLink() &&
        (await stat(childPath).then(
          facts => facts.isDirectory(),
          () => false,
        )))
    if (isDirectory) entries.push({ name: child.name, path: childPath, hidden: child.name.startsWith('.') })
  }
  entries.sort((left, right) => Number(left.hidden) - Number(right.hidden) || left.name.localeCompare(right.name))
  const segments = path.split(sep).filter(Boolean)
  const crumbs = [
    { name: sep, path: sep, hidden: false },
    ...segments.map((name, index) => ({ name, path: sep + segments.slice(0, index + 1).join(sep), hidden: name.startsWith('.') })),
  ]
  return { path, home, crumbs, entries: entries.slice(0, maxEntries), truncated: entries.length > maxEntries }
}

export const createChildDirectory = async ({ path, name }: { readonly path: string; readonly name: string }): Promise<string> => {
  if (!isAbsolute(path) || name.includes('/') || name === '.' || name === '..' || name.trim() === '') throw new Error('Choose a single folder name.')
  const target = join(await realpath(path), name.trim())
  await mkdir(target)
  return target
}
