import type { JjRevision } from './types.js'

export interface JjRunResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type JjExecutor = (input: { readonly args: readonly string[]; readonly cwd: string; readonly signal?: AbortSignal }) => Promise<JjRunResult>
export type CommandExecutor = (input: { readonly command: string; readonly cwd: string; readonly signal?: AbortSignal }) => Promise<JjRunResult>

export class JjCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly stderr: string,
  ) {
    super(message)
    this.name = 'JjCommandError'
  }
}

const REVISION_TEMPLATE = 'change_id ++ "|" ++ commit_id ++ "|" ++ conflict ++ "|" ++ description.first_line()'
const FIELD_SEPARATOR = '|'

export interface ObservedRevision extends JjRevision {
  readonly conflict: boolean
}

export const parseRevisionLine = (line: string): ObservedRevision => {
  const [changeId = '', commitId = '', conflict = 'false', ...descriptionParts] = line.trim().split(FIELD_SEPARATOR)
  if (changeId.length === 0 || !/^[0-9a-f]{40,64}$/.test(commitId)) {
    throw new JjCommandError('unexpected-output', 'Jujutsu returned a revision line that could not be parsed.', line.slice(0, 200))
  }
  return { changeId, commitId, conflict: conflict === 'true', description: descriptionParts.join(FIELD_SEPARATOR).slice(0, 200) }
}

const run = async (
  executor: JjExecutor,
  input: { readonly args: readonly string[]; readonly cwd: string; readonly signal?: AbortSignal; readonly allowFailure?: boolean; readonly label: string },
): Promise<JjRunResult> => {
  const result = await executor({ args: input.args, cwd: input.cwd, ...(input.signal === undefined ? {} : { signal: input.signal }) })
  if (result.exitCode !== 0 && input.allowFailure !== true) {
    const stderr = result.stderr.trim()
    if (/doesn't exist|no such revision|Revision .* not found/i.test(stderr)) {
      throw new JjCommandError('revision-not-found', `${input.label}: revision was not found.`, stderr)
    }
    throw new JjCommandError('jj-failed', `${input.label} failed with exit code ${String(result.exitCode)}.`, stderr)
  }
  return result
}

export const resolveRevision = async (
  executor: JjExecutor,
  cwd: string,
  revision: string,
  signal?: AbortSignal,
): Promise<ObservedRevision> => {
  const result = await run(executor, {
    args: ['log', '--no-graph', '-r', revision, '-T', REVISION_TEMPLATE],
    cwd,
    ...(signal === undefined ? {} : { signal }),
    label: `Resolve revision ${revision}`,
  })
  const line = result.stdout.trim().split('\n').find(candidate => candidate.trim().length > 0)
  if (line === undefined) throw new JjCommandError('revision-not-found', `Resolve revision ${revision}: no revision matched.`, '')
  return parseRevisionLine(line)
}

export const revisionExists = async (executor: JjExecutor, cwd: string, revision: string, signal?: AbortSignal): Promise<boolean> => {
  const result = await run(executor, {
    args: ['log', '--no-graph', '-r', revision, '-T', 'commit_id'],
    cwd,
    ...(signal === undefined ? {} : { signal }),
    allowFailure: true,
    label: `Check revision ${revision}`,
  })
  return result.exitCode === 0 && result.stdout.trim().length > 0
}

export const isAncestor = async (
  executor: JjExecutor,
  cwd: string,
  ancestorRevision: string,
  descendantRevision: string,
  signal?: AbortSignal,
): Promise<boolean> => {
  const result = await run(executor, {
    args: ['log', '--no-graph', '-r', `${ancestorRevision} & ::${descendantRevision}`, '-T', 'commit_id'],
    cwd,
    ...(signal === undefined ? {} : { signal }),
    allowFailure: true,
    label: 'Check revision ancestry',
  })
  return result.exitCode === 0 && result.stdout.trim().length > 0
}

export const mutableChangeIds = async (executor: JjExecutor, cwd: string, signal?: AbortSignal): Promise<ReadonlySet<string>> => {
  const result = await run(executor, {
    args: ['log', '--no-graph', '-r', 'mutable()', '-T', 'change_id ++ "\\n"'],
    cwd,
    ...(signal === undefined ? {} : { signal }),
    label: 'List mutable changes',
  })
  return new Set(result.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0))
}

export const duplicateOnto = async (input: {
  readonly executor: JjExecutor
  readonly cwd: string
  readonly sourceRevision: string
  readonly targetRevision: string
  readonly signal?: AbortSignal
}): Promise<ObservedRevision> => {
  const before = await mutableChangeIds(input.executor, input.cwd, input.signal)
  const result = await run(input.executor, {
    args: ['duplicate', input.sourceRevision, '--onto', input.targetRevision, '--ignore-working-copy'],
    cwd: input.cwd,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    label: 'Duplicate source revision onto the canonical target',
  })
  const after = await mutableChangeIds(input.executor, input.cwd, input.signal)
  const created = [...after].filter(changeId => !before.has(changeId))
  const first = created[0]
  if (created.length !== 1 || first === undefined) {
    throw new JjCommandError(
      'unexpected-output',
      `Duplicate produced ${String(created.length)} new changes; expected exactly one.`,
      result.stdout.slice(0, 400),
    )
  }
  return resolveRevision(input.executor, input.cwd, first, input.signal)
}

export const changedFiles = async (
  executor: JjExecutor,
  cwd: string,
  fromRevision: string,
  toRevision: string,
  signal?: AbortSignal,
): Promise<readonly string[]> => {
  const result = await run(executor, {
    args: ['diff', '--from', fromRevision, '--to', toRevision, '--summary'],
    cwd,
    ...(signal === undefined ? {} : { signal }),
    label: 'Diff revisions',
  })
  return result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.replace(/^[A-Z]+\s+/, '').trim())
    .filter(line => line.length > 0)
}

export const isRevisionEmpty = async (
  executor: JjExecutor,
  cwd: string,
  revision: string,
  signal?: AbortSignal,
): Promise<boolean> => {
  const result = await run(executor, {
    args: ['diff', '--from', `${revision}-`, '--to', revision, '--summary'],
    cwd,
    ...(signal === undefined ? {} : { signal }),
    allowFailure: true,
    label: 'Check whether a revision is empty',
  })
  return result.exitCode === 0 && result.stdout.trim().length === 0
}

export const conflictFiles = async (executor: JjExecutor, cwd: string, revision: string, signal?: AbortSignal): Promise<readonly string[]> => {
  const result = await run(executor, {
    args: ['resolve', '--list', '-r', revision],
    cwd,
    ...(signal === undefined ? {} : { signal }),
    allowFailure: true,
    label: 'List conflicts',
  })
  if (result.exitCode !== 0) return []
  return result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.split(/\s{2,}|\t/)[0]?.trim() ?? line.trim())
    .filter(line => line.length > 0)
    .slice(0, 200)
}

export const workspaceRoot = async (executor: JjExecutor, cwd: string, signal?: AbortSignal): Promise<string> => {
  const result = await run(executor, {
    args: ['root'],
    cwd,
    ...(signal === undefined ? {} : { signal }),
    allowFailure: true,
    label: 'Resolve jj repository root',
  })
  if (result.exitCode !== 0) throw new JjCommandError('not-a-jj-repository', 'Path is not inside a Jujutsu repository.', result.stderr.trim())
  const root = result.stdout.trim()
  if (root.length === 0) throw new JjCommandError('not-a-jj-repository', 'Jujutsu did not report a repository root.', '')
  return root
}

export const setBookmark = async (
  executor: JjExecutor,
  cwd: string,
  bookmark: string,
  revision: string,
  signal?: AbortSignal,
): Promise<void> => {
  await run(executor, {
    args: ['bookmark', 'set', bookmark, '-r', revision, '--allow-backwards'],
    cwd,
    ...(signal === undefined ? {} : { signal }),
    label: `Advance bookmark ${bookmark}`,
  })
}

export const addWorkspace = async (input: {
  readonly executor: JjExecutor
  readonly cwd: string
  readonly path: string
  readonly name: string
  readonly revision: string
  readonly signal?: AbortSignal
}): Promise<void> => {
  await run(input.executor, {
    args: ['workspace', 'add', input.path, '--name', input.name, '-r', input.revision],
    cwd: input.cwd,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    label: 'Create staging workspace',
  })
}

export const forgetWorkspace = async (executor: JjExecutor, cwd: string, name: string, signal?: AbortSignal): Promise<void> => {
  await run(executor, {
    args: ['workspace', 'forget', name],
    cwd,
    ...(signal === undefined ? {} : { signal }),
    allowFailure: true,
    label: 'Forget staging workspace',
  })
}

export const abandonRevision = async (executor: JjExecutor, cwd: string, revision: string, signal?: AbortSignal): Promise<void> => {
  await run(executor, {
    args: ['abandon', revision],
    cwd,
    ...(signal === undefined ? {} : { signal }),
    allowFailure: true,
    label: 'Abandon staging revision',
  })
}

export const runValidationCommand = async (input: {
  readonly execute: CommandExecutor
  readonly command: string
  readonly cwd: string
  readonly signal?: AbortSignal
}): Promise<JjRunResult> => input.execute({ command: input.command, cwd: input.cwd, ...(input.signal === undefined ? {} : { signal: input.signal }) })
