import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { SubagentCatalogs } from './SubagentHeaderLineage.js'

const catalogOf = (...childIds: string[]): SessionListState['projectionsBySession'][SessionId] => ({
  state: 'ready',
  error: null,
  values: { subagentCatalog: childIds.map((id, index) => ({ id: SessionId(id), mode: 'continuable', label: id, createdAt: index })) },
})

/** Projections whose reads are counted, so a test sees which Sessions a header folded. */
const countedProjections = (byParent: Record<string, SessionListState['projectionsBySession'][SessionId]>) => {
  const reads = new Map<string, number>()
  const projections: SessionListState['projectionsBySession'] = {}
  for (const [parentId, projection] of Object.entries(byParent)) {
    Object.defineProperty(projections, parentId, {
      enumerable: true,
      get: () => {
        reads.set(parentId, (reads.get(parentId) ?? 0) + 1)
        return projection
      },
    })
  }
  return { projections, reads }
}

const running = (id: string): SessionSummary => ({ id: SessionId(id), displayTitle: id, running: true, retainedBy: {}, blank: false, updatedAt: 1 })

describe('SubagentCatalogs', () => {
  it('builds only the catalog the header asks for', () => {
    const { projections, reads } = countedProjections({ shown: catalogOf('child'), other: catalogOf('x'), third: catalogOf('y') })
    const lookup = SubagentCatalogs.lookup({ projections, summaries: { [SessionId('child')]: running('child') }, statuses: new Map() })
    expect(lookup(SessionId('shown'))?.entries).toEqual([{ id: 'child', mode: 'continuable', label: 'child', createdAt: 0, activity: 'running' }])
    expect(lookup(SessionId('shown'))).toBe(lookup(SessionId('shown')))
    expect([...reads.keys()]).toEqual(['shown'])
  })

  it('finds the parent of the shown thread in projection order', () => {
    const projections = { [SessionId('first')]: catalogOf('a', 'shared'), [SessionId('second')]: catalogOf('shared', 'b') }
    expect(SubagentCatalogs.parentOf(projections, SessionId('shared'))).toBe('first')
    expect(SubagentCatalogs.parentOf(projections, SessionId('b'))).toBe('second')
    expect(SubagentCatalogs.parentOf(projections, SessionId('root'))).toBeUndefined()
  })
})
