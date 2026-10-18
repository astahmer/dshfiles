import { z } from 'zod'
import type { JjRun } from './revision-reads.js'

const commitIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const ROW_LIMIT = 20
const NEIGHBOURHOOD = 4

export interface ReferenceGraph {
  /** The reference exactly as the reader saw it in chat. */
  readonly label: string
  readonly commitId: string | null
  readonly changeId: string | null
  readonly graph: string
}

/**
 * `jj:` tokens reach the Host as text a reader wrote, so a reference is only ever a symbol: the quoting keeps a
 * bookmark name with `.` or `+` in it a name rather than revset syntax, and the schema refuses anything else.
 */
const referenceSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^(?:[A-Za-z0-9][A-Za-z0-9._/+:-]*|[k-z]{8,64}|[0-9a-f]{7,64})$/u)

/** The reference itself, its neighbourhood, and the landmarks a reader compares against. */
const revset = (input: { readonly reference: string; readonly hasDefaultWorkspace: boolean }): string =>
  [
    `(${input.reference})`,
    `ancestors(${input.reference}, ${String(NEIGHBOURHOOD)})`,
    `descendants(${input.reference}, ${String(NEIGHBOURHOOD)})`,
    '@',
    'present(main)',
    'present(main@origin)',
    ...(input.hasDefaultWorkspace ? ['default@'] : []),
  ].join(' | ')

/**
 * One row per revision: the referenced revision is marked `>`, the working copy `@`, every bookmark is named, and the
 * default workspace's revision carries `default@` the way the thread-workspace preview names it.
 */
const template = (input: { readonly commitId: string; readonly defaultCommitId: string | undefined }): string =>
  [
    'change_id.short(8)',
    '" "',
    `if(commit_id.short(64) == ${JSON.stringify(input.commitId)}, ">", " ")`,
    `if(current_working_copy, "@", " ")`,
    'local_bookmarks.map(|bookmark| bookmark.name()).join(",")',
    '" "',
    'remote_bookmarks.map(|bookmark| bookmark.name() ++ "@" ++ bookmark.remote()).join(",")',
    '" "',
    input.defaultCommitId === undefined ? '""' : `if(commit_id.short(64) == ${JSON.stringify(input.defaultCommitId)}, "default@", "")`,
    '" "',
    'description.first_line().substr(0, 60)',
    '"\\n"',
  ].join(' ++ ')

const rows = (output: string): readonly string[] =>
  output
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.length > 0)

const readReferenceGraph = async (input: { readonly run: JjRun; readonly reference: string }): Promise<ReferenceGraph> => {
  const reference = JSON.stringify(referenceSchema.parse(input.reference))
  const read = async (args: readonly string[]): Promise<string> => {
    const result = await input.run(['--ignore-working-copy', '--no-pager', '--color=never', ...args])
    if (result.truncated) throw new Error('The reference graph exceeded the bounded output limit.')
    return result.stdout
  }
  const resolved = rows(await read(['log', '--no-graph', '--limit', '1', '-r', reference, '-T', 'separate("\\n", commit_id, change_id.short())']))
  const commitId = resolved.at(0)
  const changeId = resolved.at(1)
  if (commitId === undefined || changeId === undefined || !commitIdSchema.safeParse(commitId).success) {
    throw new Error('That reference does not name one revision in this repository.')
  }
  const hasDefaultWorkspace = rows(await read(['workspace', 'list', '-T', 'name ++ "\\n"'])).includes('default')
  const defaultCommitId = hasDefaultWorkspace ? rows(await read(['log', '--no-graph', '--limit', '1', '-r', 'default@', '-T', 'commit_id'])).at(0) : undefined
  const graph = await read([
    'log',
    '--limit',
    String(ROW_LIMIT),
    '-r',
    revset({ reference, hasDefaultWorkspace }),
    '-T',
    template({ commitId, defaultCommitId }),
  ])
  return { label: input.reference, commitId, changeId, graph: graph.trimEnd() }
}

export class ReferenceGraphModel {
  static readonly revset = revset
  static readonly template = template
  static readonly read = readReferenceGraph
}
