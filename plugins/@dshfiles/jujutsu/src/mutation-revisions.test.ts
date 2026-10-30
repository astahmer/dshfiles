import { describe, expect, it } from 'vitest'
import type { Mutation } from './api.js'
import { missingMutationRevisionIds } from './mutation-revisions.js'

const revision = (commitId: string) => ({ commitId })

describe('missingMutationRevisionIds', () => {
  it('resolves action targets loaded from older graph pages, beyond the initial snapshot', () => {
    const firstPageRevision = revision('a'.repeat(40))
    const pagedRevisionId = 'b'.repeat(40)
    const action: Mutation = { kind: 'duplicate', commitId: pagedRevisionId }

    expect(missingMutationRevisionIds(action, [firstPageRevision])).toEqual([pagedRevisionId])
  })

  it('returns only unique missing revision targets for a multi-revision action', () => {
    const firstPageRevision = revision('a'.repeat(40))
    const pagedRevisionId = 'b'.repeat(40)
    const action: Mutation = { kind: 'rebase', sourceId: pagedRevisionId, destinationId: firstPageRevision.commitId }

    expect(missingMutationRevisionIds(action, [firstPageRevision])).toEqual([pagedRevisionId])
  })

  it('does not look up revision records for actions without revision targets', () => {
    expect(missingMutationRevisionIds({ kind: 'fetch', remote: 'origin' }, [])).toEqual([])
  })
})
