import { describe, expect, it } from 'vitest'
import { mergedPullRequestClosers } from './forge-links.js'
import type { PullRequestView } from './pull-request-state.js'

const view = (input: Partial<PullRequestView>): PullRequestView => ({
  url: 'https://github.com/astahmer/dshfiles/pull/42',
  repo: 'astahmer/dshfiles',
  number: 42,
  state: 'open',
  checks: 'none',
  watched: true,
  body: null,
  checkedAt: null,
  ...input,
})

describe('merged pull request closers', () => {
  it('reads the closing references of a merged description only', () => {
    const body = 'Adds hosts.\n\nCloses b:k3f9, fixes b:12\n\nMentions b:abcd without closing it.'
    expect(mergedPullRequestClosers([view({ state: 'merged', body })])).toEqual([{ url: 'https://github.com/astahmer/dshfiles/pull/42', refs: ['k3f9', '12'] }])
    expect(mergedPullRequestClosers([view({ state: 'open', body })])).toEqual([])
    expect(mergedPullRequestClosers([view({ state: 'closed', body })])).toEqual([])
  })

  it('skips a description that closes nothing and a snapshot that predates bodies', () => {
    expect(mergedPullRequestClosers([view({ state: 'merged', body: 'No closing words here, b:k3f9.' })])).toEqual([])
    expect(mergedPullRequestClosers([view({ state: 'merged', body: null })])).toEqual([])
  })
})
