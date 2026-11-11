import { describe, expect, it } from 'vitest'
import { forgeTargetOf, forgeTargetOfRemoteUrl, parseForgePullRequestUrl, pullRequestUrlOf, repositoryKeyOf } from './forge.js'
import { normalizeMergeRequest } from './gitlab-cli.js'

describe('forge targets', () => {
  it('parses GitHub pull-request URLs strictly', () => {
    expect(parseForgePullRequestUrl('https://github.com/acme/widget/pull/12')).toEqual({
      kind: 'github',
      host: 'github.com',
      project: 'acme/widget',
      number: 12,
      url: 'https://github.com/acme/widget/pull/12',
    })
    expect(parseForgePullRequestUrl('https://github.com/acme/widget/pull/12/')).toMatchObject({ number: 12 })
    expect(parseForgePullRequestUrl('http://github.com/acme/widget/pull/12')).toBeUndefined()
    expect(parseForgePullRequestUrl('https://user:pw@github.com/acme/widget/pull/12')).toBeUndefined()
    expect(parseForgePullRequestUrl('https://github.com/acme/widget/pull/0')).toBeUndefined()
    expect(parseForgePullRequestUrl('https://github.com/acme/widget/issues/12')).toBeUndefined()
  })

  it('parses GitLab merge-request URLs, including nested groups and a self-hosted host', () => {
    expect(parseForgePullRequestUrl('https://gitlab.com/group/project/-/merge_requests/7')).toEqual({
      kind: 'gitlab',
      host: 'gitlab.com',
      project: 'group/project',
      number: 7,
      url: 'https://gitlab.com/group/project/-/merge_requests/7',
    })
    expect(parseForgePullRequestUrl('https://gitlab.example.com/team/sub/project/-/merge_requests/9')).toMatchObject({
      host: 'gitlab.example.com',
      project: 'team/sub/project',
      number: 9,
    })
    expect(parseForgePullRequestUrl('https://gitlab.com/group/project/merge_requests/7')).toBeUndefined()
    expect(parseForgePullRequestUrl('http://gitlab.com/group/project/-/merge_requests/7')).toBeUndefined()
  })

  it('keeps a bare owner/name GitHub and treats a dotted first segment as a forge host', () => {
    expect(forgeTargetOf('acme/widget')).toEqual({ kind: 'github', host: 'github.com', project: 'acme/widget' })
    expect(forgeTargetOf('gitlab.com/group/project')).toEqual({ kind: 'gitlab', host: 'gitlab.com', project: 'group/project' })
    expect(forgeTargetOf('gitlab.example.com/group/sub/project')).toMatchObject({ host: 'gitlab.example.com', project: 'group/sub/project' })
    expect(forgeTargetOf('not a repo')).toBeUndefined()
  })

  it('round-trips the stored key and the pull-request URL for both forges', () => {
    const github = forgeTargetOf('acme/widget')
    const gitlab = forgeTargetOf('gitlab.com/group/project')
    if (github === undefined || gitlab === undefined) throw new Error('fixtures must resolve')
    expect(repositoryKeyOf(github)).toBe('acme/widget')
    expect(repositoryKeyOf(gitlab)).toBe('gitlab.com/group/project')
    expect(pullRequestUrlOf(github, 3)).toBe('https://github.com/acme/widget/pull/3')
    expect(pullRequestUrlOf(gitlab, 3)).toBe('https://gitlab.com/group/project/-/merge_requests/3')
  })

  it('reads remote URLs in ssh, scp and https forms', () => {
    expect(forgeTargetOfRemoteUrl('git@github.com:acme/widget.git')).toMatchObject({ kind: 'github', project: 'acme/widget' })
    expect(forgeTargetOfRemoteUrl('https://github.com/acme/widget')).toMatchObject({ kind: 'github', project: 'acme/widget' })
    expect(forgeTargetOfRemoteUrl('ssh://git@gitlab.example.com/team/sub/project.git')).toMatchObject({
      kind: 'gitlab',
      host: 'gitlab.example.com',
      project: 'team/sub/project',
    })
    expect(forgeTargetOfRemoteUrl('/Users/me/repos/local')).toBeUndefined()
    expect(forgeTargetOfRemoteUrl('file:///tmp/repo')).toBeUndefined()
  })
})

describe('GitLab merge-request normalization', () => {
  const base = { iid: 4, state: 'opened', detailed_merge_status: 'mergeable' }

  it('maps an open merge request with a green pipeline', () => {
    expect(normalizeMergeRequest({ ...base, head_pipeline: { status: 'success' }, approvals_required: 0 })).toMatchObject({
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: 'APPROVED',
      statusCheckRollup: [{ context: 'pipeline', state: 'SUCCESS' }],
    })
  })

  it('maps conflicts, drafts, blocked discussions, a failing pipeline and a required review', () => {
    expect(normalizeMergeRequest({ ...base, detailed_merge_status: 'conflict' })).toMatchObject({ mergeable: 'CONFLICTING', mergeStateStatus: 'BLOCKED' })
    expect(normalizeMergeRequest({ ...base, detailed_merge_status: 'draft_status' })).toMatchObject({ mergeStateStatus: 'DRAFT' })
    expect(normalizeMergeRequest({ ...base, blocking_discussions_resolved: false })).toMatchObject({ mergeStateStatus: 'BLOCKED' })
    expect(normalizeMergeRequest({ ...base, head_pipeline: { status: 'failed' }, approvals_required: 2 })).toMatchObject({
      reviewDecision: 'REVIEW_REQUIRED',
      statusCheckRollup: [{ context: 'pipeline', state: 'FAILURE' }],
    })
  })

  it('prioritizes draft over blocked and blocked over an unstable pipeline', () => {
    expect(normalizeMergeRequest({ ...base, detailed_merge_status: 'draft', blocking_discussions_resolved: false })).toMatchObject({
      mergeStateStatus: 'DRAFT',
    })
    expect(normalizeMergeRequest({ ...base, detailed_merge_status: 'ci_still_running', blocking_discussions_resolved: false })).toMatchObject({
      mergeStateStatus: 'BLOCKED',
    })
    expect(normalizeMergeRequest({ ...base, detailed_merge_status: 'ci_still_running' })).toMatchObject({ mergeStateStatus: 'UNSTABLE' })
  })

  it('maps merged and closed states and keeps only well-formed note timestamps', () => {
    expect(normalizeMergeRequest({ ...base, state: 'merged' })).toMatchObject({ state: 'MERGED' })
    expect(normalizeMergeRequest({ ...base, state: 'closed' })).toMatchObject({ state: 'CLOSED' })
    const notes = [
      { created_at: '2026-01-02T03:04:05Z', author: { username: 'ana' } },
      { created_at: 'yesterday', author: { username: 'bo' } },
    ]
    expect(normalizeMergeRequest({ ...base, notes })).toMatchObject({ comments: [{ author: { login: 'ana' }, createdAt: '2026-01-02T03:04:05Z' }] })
  })

  it('leaves unknown statuses readable instead of guessing', () => {
    expect(normalizeMergeRequest({ iid: 1, state: 'opened' })).toMatchObject({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', reviewDecision: null })
  })
})
