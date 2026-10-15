import { z } from 'zod'
import { revisionSchema, type GraphNavigation, type RevisionRelationship } from './api.js'
import { parseJsonLines } from './core.js'
import { REVISION_TEMPLATE } from './jj-templates.js'
import type { JjRun } from './revision-reads.js'

const commitIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const operationIdSchema = z.string().regex(/^[a-f0-9]{128}$/)
const LIMIT = 500

const pinned = async (run: JjRun) => {
  const result = await run(['--ignore-working-copy', 'op', 'log', '--limit', '1', '--no-graph', '--template', 'id'])
  if (result.truncated) throw new Error('Revision operation exceeded the output limit.')
  const operationId = operationIdSchema.parse(result.stdout.trim())
  const read: JjRun = (args, options) => run(['--ignore-working-copy', '--at-operation', operationId, ...args], options)
  const revisions = async (revset: string) => {
    const output = await read(['log', '--no-graph', '--limit', String(LIMIT + 1), '-r', revset, '-T', REVISION_TEMPLATE])
    if (output.truncated) throw new Error('Revision graph exceeded the bounded output limit.')
    const rows = parseJsonLines(output.stdout, value => revisionSchema.parse(value))
    return { revisions: rows.slice(0, LIMIT), truncated: rows.length > LIMIT }
  }
  const ids = async (revset: string) => {
    const output = await read(['log', '--no-graph', '--limit', String(LIMIT + 1), '-r', revset, '-T', 'commit_id ++ "\\n"'])
    if (output.truncated) throw new Error('Revision IDs exceeded the bounded output limit.')
    const values =
      output.stdout.trim() === ''
        ? []
        : output.stdout
            .trim()
            .split('\n')
            .map(value => commitIdSchema.parse(value))
    return { ids: values.slice(0, LIMIT), truncated: values.length > LIMIT }
  }
  const count = async (revset: string) => {
    const output = await read(['log', '--no-graph', '-r', revset, '-T', '"x"'], { outputLimit: 1_000_000 })
    if (output.truncated || !/^x*$/.test(output.stdout)) throw new Error('Revision exact count exceeded the bounded output limit.')
    return output.stdout.length
  }
  return { operationId, revisions, ids, count }
}

export const readGraphNavigation = async (run: JjRun): Promise<GraphNavigation> => {
  const snapshot = await pinned(run)
  const landmarks: GraphNavigation['landmarks'] = []
  const definitions = [
    { kind: 'current', label: 'Current', revset: '@' },
    { kind: 'main-origin', label: 'main@origin', revset: 'remote_bookmarks(exact:main, exact:origin)' },
    { kind: 'main', label: 'main', revset: 'bookmarks(exact:main)' },
    { kind: 'default', label: 'Default', revset: 'present(default@)' },
  ] satisfies { kind: GraphNavigation['landmarks'][number]['kind']; label: string; revset: string }[]
  for (const definition of definitions) {
    const result = await snapshot.revisions(definition.revset)
    if (result.truncated) throw new Error('Bookmark resolution exceeded the bounded output limit.')
    landmarks.push({
      kind: definition.kind,
      label: definition.label,
      status: result.revisions.length === 0 ? 'missing' : result.revisions.length === 1 ? 'resolved' : 'ambiguous',
      revisions: result.revisions,
    })
  }
  return { operationId: snapshot.operationId, landmarks }
}

export const readRevisionRelationship = async (input: { run: JjRun; commitId: string; targetCommitId: string }): Promise<RevisionRelationship> => {
  const selected = commitIdSchema.parse(input.commitId)
  const target = commitIdSchema.parse(input.targetCommitId)
  const snapshot = await pinned(input.run)
  const endpoints = await snapshot.ids(`${selected} | ${target}`)
  if (!endpoints.ids.includes(selected) || !endpoints.ids.includes(target)) throw new Error('Revision is unavailable at this operation.')
  const selectedOnlyCount = await snapshot.count(`::${selected} ~ ::${target}`)
  const targetOnlyCount = await snapshot.count(`::${target} ~ ::${selected}`)
  const common = `heads(::${selected} & ::${target})`
  const connection = `(${common}):: & (::${selected} | ::${target})`
  const difference = `::${selected} ~ ::${target}`
  const ancestors = await snapshot.ids(common)
  const connectionIds = await snapshot.ids(connection)
  const historyIds = await snapshot.ids(`::${selected}`)
  const differenceIds = await snapshot.ids(difference)
  const rows = await snapshot.revisions(`${selected} | ${target} | (${connection}) | ::${selected}`)
  const endpointRows = await snapshot.revisions(`${selected} | ${target}`)
  const endpointIds = new Set(endpointRows.revisions.map(revision => revision.commitId))
  const combined = [...endpointRows.revisions, ...rows.revisions.filter(revision => !endpointIds.has(revision.commitId))]
  return {
    operationId: snapshot.operationId,
    commitId: selected,
    targetCommitId: target,
    relation:
      selected === target
        ? 'same'
        : selectedOnlyCount === 0
          ? 'ancestor'
          : targetOnlyCount === 0
            ? 'descendant'
            : ancestors.ids.length === 0
              ? 'no-common-ancestor'
              : 'diverged',
    selectedOnlyCount,
    targetOnlyCount,
    commonAncestorIds: ancestors.ids,
    commonAncestorsTruncated: ancestors.truncated,
    connectionIds: connectionIds.ids,
    historyIds: historyIds.ids,
    differenceIds: differenceIds.ids,
    revisions: combined.slice(0, LIMIT),
    truncated: ancestors.truncated || connectionIds.truncated || historyIds.truncated || differenceIds.truncated || rows.truncated || combined.length > LIMIT,
  }
}

export const readGraphSlice = async (input: { run: JjRun; commitId: string; mode: 'history' | 'exclusive' }) => {
  const selected = commitIdSchema.parse(input.commitId)
  const snapshot = await pinned(input.run)
  const roots = `(heads(all()) | bookmarks() | remote_bookmarks() | working_copies()) ~ ${selected}`
  const result = await snapshot.revisions(input.mode === 'history' ? `::${selected}` : `::${selected} ~ ::(${roots})`)
  return { operationId: snapshot.operationId, ...result }
}
