import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export interface ThreadLocation {
  /** Root of the checkout that owns the jj store; thread workspaces sit in its `-threads` sibling. */
  readonly repoRoot: string
  readonly workspaceRoot: string
  readonly threadName: string | undefined
}

const isSecondaryWorkspace = (location: ThreadLocation): boolean => location.workspaceRoot !== location.repoRoot

const defaultThreadsDirectory = (repoRoot: string): string => `${repoRoot}-threads`

/** `dshx checkout sync` from the dshx this plugin builds with; accepts an exact landed commit or the bookmark tip. */
const checkoutSyncArgv = (input: {
  readonly repoRoot: string
  readonly workspace: string
  readonly bookmark: string
  readonly revision?: string | undefined
}): readonly string[] => [
  process.execPath,
  join(dirname(createRequire(import.meta.url).resolve('@dshfiles/dshx')), 'cli', 'bin.js'),
  'checkout',
  'sync',
  '--workspace',
  input.workspace,
  '--bookmark',
  input.bookmark,
  ...(input.revision === undefined ? [] : ['--revision', input.revision]),
  '--cwd',
  input.repoRoot,
  '--json',
]

export class ThreadWorkspaceModel {
  static readonly isSecondaryWorkspace = isSecondaryWorkspace
  static readonly defaultThreadsDirectory = defaultThreadsDirectory
  static readonly checkoutSyncArgv = checkoutSyncArgv
}
