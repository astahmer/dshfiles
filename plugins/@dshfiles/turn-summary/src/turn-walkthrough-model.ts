import type { EditedFile } from './turn-activity.js'

/** One file of a folder a turn edited: the name the card shows, and the path that opens it. */
export interface WalkthroughFile extends EditedFile {
  readonly fullPath: string
}

/** The files of one folder a turn edited, with their line totals and the one-line summary the card shows. */
export interface WalkthroughGroup {
  readonly directory: string
  readonly files: readonly WalkthroughFile[]
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

/**
 * Groups a turn's edited files by folder, below the folder they all share, in first-edit order: "src · 2 files", then
 * "+40 −3". Each file keeps only its name, since its group already names the folder.
 */
const groups = (files: readonly EditedFile[]): readonly WalkthroughGroup[] => {
  const shared = sharedPrefix(files.map(file => directoryOf(file.path)))
  const byDirectory = new Map<string, WalkthroughFile[]>()
  for (const file of files) {
    const segments = file.path.split('/')
    const directory = segments.slice(shared, -1).join('/')
    const relative: WalkthroughFile = { ...file, path: segments.at(-1) ?? file.path, fullPath: file.path }
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), relative])
  }
  const root = files[0] === undefined ? '' : directoryOf(files[0].path).slice(0, shared).join('/')
  return [...byDirectory].map(([directory, grouped]) => {
    const added = grouped.reduce((total, file) => total + file.added, 0)
    const removed = grouped.reduce((total, file) => total + file.removed, 0)
    return {
      directory: directory === '' ? (root === '' ? '.' : (root.split('/').at(-1) ?? root)) : directory,
      files: grouped,
      added,
      removed,
      // The card's header already counts the folder's files and each row carries its own lines, so the one thing left
      // to say is the folder's total, and only where it adds rows up.
      summary: grouped.length > 1 && added + removed > 0 ? `+${String(added)} −${String(removed)}` : '',
    }
  })
}

/** The native address of one turn's changed-files review; diffs-review's Changes facet claims it when loaded. */
const changesAddress = (input: { readonly sessionId: string; readonly seq: number; readonly turn: number }): string =>
  `dsh-resource://changes-review/session/${encodeURIComponent(input.sessionId)}/${String(input.seq)}/${String(input.turn)}`

/**
 * Whether the walkthrough says more than the file chips above it: files the chips fold into "+N more", or files in more
 * than one folder. For one or two files of one folder it would repeat the chips line for line, so it is not offered.
 */
const addsDetail = (files: readonly EditedFile[], chipLimit: number): boolean =>
  files.length > chipLimit || new Set(files.map(file => directoryOf(file.path).join('/'))).size > 1

export class TurnWalkthroughModel {
  static readonly groups = groups
  static readonly addsDetail = addsDetail
  static readonly changesAddress = changesAddress
}
