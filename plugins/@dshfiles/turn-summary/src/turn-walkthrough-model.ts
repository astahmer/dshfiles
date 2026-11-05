import type { EditedFile } from './turn-activity.js'

/** The files of one folder a turn edited, with their line totals and the one-line summary the card shows. */
export interface WalkthroughGroup {
  readonly directory: string
  readonly files: readonly EditedFile[]
  readonly added: number
  readonly removed: number
  readonly summary: string
}

const directoryOf = (path: string): readonly string[] => path.split('/').slice(0, -1)

const sharedPrefix = (directories: readonly (readonly string[])[]): number => {
  const [first, ...rest] = directories
  if (first === undefined) return 0
  let length = 0
  while (length < first.length && rest.every(directory => directory[length] === first[length])) length += 1
  return length
}

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? '' : 's'}`

/**
 * Groups a turn's edited files by folder, below the folder they all share, in first-edit order: "src · 2 files +40 −3".
 * Each file keeps only its name, since its group already names the folder.
 */
const groups = (files: readonly EditedFile[]): readonly WalkthroughGroup[] => {
  const shared = sharedPrefix(files.map(file => directoryOf(file.path)))
  const byDirectory = new Map<string, EditedFile[]>()
  for (const file of files) {
    const segments = file.path.split('/')
    const directory = segments.slice(shared, -1).join('/')
    const relative = { ...file, path: segments.at(-1) ?? file.path }
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), relative])
  }
  const root = files[0] === undefined ? '' : directoryOf(files[0].path).slice(0, shared).join('/')
  return [...byDirectory].map(([directory, grouped]) => {
    const added = grouped.reduce((total, file) => total + file.added, 0)
    const removed = grouped.reduce((total, file) => total + file.removed, 0)
    const lines = added + removed > 0 ? ` · +${String(added)} −${String(removed)}` : ''
    return {
      directory: directory === '' ? (root === '' ? '.' : (root.split('/').at(-1) ?? root)) : directory,
      files: grouped,
      added,
      removed,
      summary: `Edited ${plural(grouped.length, 'file')}${lines}`,
    }
  })
}

/** The native address of one turn's changed-files review; pulls-review's Changes facet claims it when loaded. */
const changesAddress = (input: { readonly sessionId: string; readonly seq: number; readonly turn: number }): string =>
  `dsh-resource://changes-review/session/${encodeURIComponent(input.sessionId)}/${String(input.seq)}/${String(input.turn)}`

export class TurnWalkthroughModel {
  static readonly groups = groups
  static readonly changesAddress = changesAddress
}
