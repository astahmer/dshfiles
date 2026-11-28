import type { RemoteComment, RemoteRecord, RemoteRelation, RemoteStatus } from '@dshfiles/backlog/backlog-provider'
import { Schema } from 'effect'

type Status = RemoteStatus['category']

const ownerRepoPart = '[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}'
const repositoryPattern = new RegExp(`^${ownerRepoPart}/${ownerRepoPart}$`, 'u')
const keyPattern = new RegExp(`^(${ownerRepoPart}/${ownerRepoPart})#(\\d{1,9})$`, 'u')

const labelSchema = Schema.Struct({ id: Schema.Number, name: Schema.String })
const repositoryRefSchema = Schema.Struct({ full_name: Schema.optionalKey(Schema.NullOr(Schema.String)) })

export const issueSchema = Schema.Struct({
  id: Schema.Number,
  number: Schema.Number,
  html_url: Schema.String,
  title: Schema.String,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  state: Schema.String,
  labels: Schema.optionalKey(Schema.NullOr(Schema.Array(labelSchema))),
  updated_at: Schema.String,
  pull_request: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
  repository: Schema.optionalKey(Schema.NullOr(repositoryRefSchema)),
})
export type GiteaIssue = typeof issueSchema.Type

export const commentSchema = Schema.Struct({
  id: Schema.Number,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
  user: Schema.optionalKey(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
})
export type GiteaComment = typeof commentSchema.Type

export { labelSchema }
export type GiteaLabel = typeof labelSchema.Type

export const repositorySchema = Schema.Struct({
  full_name: Schema.String,
  html_url: Schema.optionalKey(Schema.String),
  has_issues: Schema.optionalKey(Schema.Boolean),
  archived: Schema.optionalKey(Schema.Boolean),
})

/**
 * Gitea has only open and closed, and no close reason: open stands for inbox, todo and doing, closed for done and
 * dropped, so neither side reads a lossy status as a change.
 */
const statusOf = (state: string): RemoteStatus =>
  state === 'closed'
    ? { category: 'done', label: 'closed', equivalents: ['done', 'dropped'] }
    : { category: 'todo', label: 'open', equivalents: ['inbox', 'todo', 'doing'] }

const stateOf = (status: Status): 'open' | 'closed' => (status === 'done' || status === 'dropped' ? 'closed' : 'open')

/** An issue's key: `owner/repo#42`, unique across the repositories one connection reaches. */
const keyOf = (repository: string, number: number): string => `${repository}#${String(number)}`

const parseKey = (key: string): { readonly repository: string; readonly number: number } | undefined => {
  const match = keyPattern.exec(key.trim())
  return match?.[1] === undefined || match[2] === undefined ? undefined : { repository: match[1], number: Number(match[2]) }
}

/** `/owner/repo/issues/42` under the site's web root; anything else (pulls, another host) is not an issue reference. */
const urlReference = (reference: string, site: { readonly web: string; readonly host: string }) => {
  if (!URL.canParse(reference)) return undefined
  const url = new URL(reference)
  if (url.hostname.toLowerCase() !== site.host) return undefined
  const root = new URL(site.web).pathname.replace(/\/+$/u, '')
  if (!url.pathname.startsWith(`${root}/`)) return undefined
  const match = new RegExp(`^/(${ownerRepoPart}/${ownerRepoPart})/issues/(\\d{1,9})/?$`, 'u').exec(url.pathname.slice(root.length))
  return match?.[1] === undefined || match[2] === undefined ? undefined : { repository: match[1], number: Number(match[2]) }
}

/**
 * The issue a reference names: `42` or `#42` within `repository`, `owner/repo#42`, or an issue URL on the site.
 * Undefined for anything else, so nothing a user typed reaches a request path unchecked.
 */
const locate = (
  reference: string,
  repository: string | undefined,
  site: { readonly web: string; readonly host: string },
): { readonly repository: string; readonly number: number } | undefined => {
  const trimmed = reference.trim()
  const plain = /^#?(\d{1,9})$/u.exec(trimmed)
  if (plain?.[1] !== undefined) return repository === undefined || !repositoryPattern.test(repository) ? undefined : { repository, number: Number(plain[1]) }
  return parseKey(trimmed) ?? urlReference(trimmed, site)
}

/** The `owner/repo` of an issue a dependency list answers: its repository, else its URL. */
const repositoryOfIssue = (issue: GiteaIssue, site: { readonly web: string; readonly host: string }): string | undefined => {
  const named = issue.repository?.full_name
  if (named !== undefined && named !== null && repositoryPattern.test(named)) return named
  return urlReference(issue.html_url, site)?.repository
}

/** The Gitea issue in backlog vocabulary: what the port calls `toCanonical`. */
const toCanonical = (input: {
  readonly repository: string
  readonly issue: GiteaIssue
  readonly comments?: readonly GiteaComment[] | undefined
  readonly relations?: readonly RemoteRelation[] | undefined
}): RemoteRecord => {
  const issue = input.issue
  return {
    key: keyOf(input.repository, issue.number),
    displayKey: keyOf(input.repository, issue.number),
    url: issue.html_url,
    title: issue.title,
    body: issue.body ?? '',
    status: statusOf(issue.state),
    tags: (issue.labels ?? []).map(label => label.name.toLowerCase()),
    ...(input.relations !== undefined && { relations: input.relations }),
    ...(input.comments !== undefined && { comments: input.comments.map(commentOf) }),
    updatedAt: Date.parse(issue.updated_at) || 0,
    version: issue.updated_at,
  }
}

const commentOf = (comment: GiteaComment): RemoteComment => ({
  id: String(comment.id),
  body: comment.body ?? '',
  author: comment.user?.login ?? 'Gitea',
  createdAt: Date.parse(comment.created_at) || 0,
})

/** A stable, readable color for a label the provider creates, from its name. */
const labelColor = (name: string): string => {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const palette = ['#5b8def', '#3fb68b', '#e2a03f', '#d9534f', '#9b6bd3', '#2ab7ca', '#7d8c99', '#e86f9d'] as const
  return palette[hash % palette.length] ?? '#7d8c99'
}

/** Whether a binding option reads as off: `no`, `false`, `off` or `0`. Empty keeps the default. */
const isOff = (value: string | undefined): boolean => ['no', 'false', 'off', '0'].includes((value ?? '').trim().toLowerCase())

export class GiteaMapping {
  static readonly repositoryPattern = repositoryPattern
  static readonly statusOf = statusOf
  static readonly stateOf = stateOf
  static readonly keyOf = keyOf
  static readonly parseKey = parseKey
  static readonly locate = locate
  static readonly repositoryOfIssue = repositoryOfIssue
  static readonly toCanonical = toCanonical
  static readonly commentOf = commentOf
  static readonly labelColor = labelColor
  static readonly isOff = isOff
}
