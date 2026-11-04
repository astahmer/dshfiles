import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import type { VcsKind } from '@dshfiles/vcs-provider-port/detect'

/** The version-control system a thread workspace backend drives; jj wins when a checkout has both `.jj` and `.git`. */
export type { VcsKind }

export interface ThreadLocation {
  /** Root of the checkout that owns the jj store or the main git worktree; thread workspaces sit in its `-threads` sibling. */
  readonly repoRoot: string
  readonly workspaceRoot: string
  readonly threadName: string | undefined
  /** Which backend located it; absent means jj (locations built before git support). */
  readonly vcs?: VcsKind | undefined
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
