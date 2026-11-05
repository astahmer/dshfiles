import { BacklogProviders, type ProviderBindingOptions, type RemoteCriterion, type RemoteRelation, type RemoteStatus } from '@dshfiles/backlog/backlog-provider'
import { Schema } from 'effect'
import { JiraAdf, type AdfNode } from './jira-adf.js'

type Status = (typeof BacklogProviders.statuses)[number]
type Priority = (typeof BacklogProviders.priorities)[number]
type Relation = (typeof BacklogProviders.relations)[number]

/** Jira's three status categories: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflow-status-categories/ */
const categoryKeys = ['new', 'indeterminate', 'done'] as const
type CategoryKey = (typeof categoryKeys)[number]

const statusSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  name: Schema.String,
  statusCategory: Schema.optionalKey(Schema.Struct({ key: Schema.String })),
})
const linkedIssueSchema = Schema.Struct({ id: Schema.String, key: Schema.String })
const issueLinkSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Struct({ name: Schema.String }),
  inwardIssue: Schema.optionalKey(linkedIssueSchema),
  outwardIssue: Schema.optionalKey(linkedIssueSchema),
})
const adfOrText = Schema.NullOr(Schema.Union([Schema.String, JiraAdf.nodeSchema]))

/** The fields a pull, fetch or push reads; custom fields the binding names come as extra keys. */
const issueSchema = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  fields: Schema.StructWithRest(
    Schema.Struct({
      summary: Schema.optionalKey(Schema.NullOr(Schema.String)),
      description: Schema.optionalKey(adfOrText),
      status: Schema.optionalKey(Schema.NullOr(statusSchema)),
      labels: Schema.optionalKey(Schema.Array(Schema.String)),
      priority: Schema.optionalKey(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
      parent: Schema.optionalKey(Schema.NullOr(linkedIssueSchema)),
      issuelinks: Schema.optionalKey(Schema.Array(issueLinkSchema)),
      duedate: Schema.optionalKey(Schema.NullOr(Schema.String)),
      issuetype: Schema.optionalKey(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
      updated: Schema.String,
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
})

const transitionSchema = Schema.Struct({ id: Schema.String, name: Schema.String, to: statusSchema })

export type JiraIssue = typeof issueSchema.Type
export type JiraStatus = typeof statusSchema.Type
export type JiraTransition = typeof transitionSchema.Type
export type JiraIssueLink = typeof issueLinkSchema.Type

const normalized = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/['’]/gu, '')
    .replace(/[\s_-]+/gu, ' ')

const statusAliases = {
  inbox: ['inbox', 'triage', 'new', 'open'],
  todo: ['to do', 'todo', 'backlog', 'selected for development', 'planned'],
  doing: ['in progress', 'doing', 'in review', 'review'],
  done: ['done', 'closed', 'resolved', 'complete', 'completed', 'shipped'],
  dropped: ['wont do', 'won t do', 'cancelled', 'canceled', 'declined', 'rejected', 'duplicate', 'obsolete', 'dropped', 'abandoned'],
} as const satisfies Record<Status, readonly string[]>

const aliasOf = (name: string): Status | undefined => {
  const key = normalized(name)
  return BacklogProviders.statuses.find(status => statusAliases[status].some(alias => alias === key))
}

const categoryOf = (status: JiraStatus): CategoryKey | undefined => categoryKeys.find(key => key === status.statusCategory?.key)

/**
 * A Jira status in backlog terms, by its category: To Do (`new`) reads as todo and stands for inbox too (an Inbox or
 * Triage name reads as inbox), In Progress (`indeterminate`) as doing, Done as done, or dropped for a Won't Do,
 * Cancelled or Declined name.
 */
const statusOf = (status: JiraStatus): RemoteStatus => {
  const named = aliasOf(status.name)
  switch (categoryOf(status)) {
    case 'done':
      return BacklogProviders.exactStatus(named === 'dropped' ? 'dropped' : 'done', status.name)
    case 'indeterminate':
      return BacklogProviders.exactStatus('doing', status.name)
    case 'new':
      return named === 'inbox' ? BacklogProviders.exactStatus('inbox', status.name) : { category: 'todo', label: status.name, equivalents: ['todo', 'inbox'] }
    case undefined:
      return named === undefined ? { category: 'todo', label: status.name, equivalents: [] } : BacklogProviders.exactStatus(named, status.name)
  }
}

const categoryFor = (status: Status): CategoryKey => (status === 'doing' ? 'indeterminate' : status === 'done' || status === 'dropped' ? 'done' : 'new')

/** Whether a Jira status is where a backlog status (or a status name the binding chose) should land. */
const reaches = (to: JiraStatus, target: { readonly status: Status; readonly label?: string | undefined }): boolean => {
  if (target.label !== undefined) return normalized(to.name) === normalized(target.label)
  return categoryOf(to) === categoryFor(target.status)
}

/** How well a status fits: the binding's name, then a name that reads as that exact status, then its category. */
const fit = (to: JiraStatus, target: { readonly status: Status; readonly label?: string | undefined }): number => {
  if (!reaches(to, target)) return 0
  if (target.label !== undefined) return 3
  const named = aliasOf(to.name)
  if (named === target.status) return 2
  // A Done-category status reads as dropped only by name: `done` never lands on a Won't Do, `dropped` falls back to Done.
  if (target.status === 'done' && named === 'dropped') return 0
  return 1
}

export type TransitionStep =
  | { readonly kind: 'already' }
  | { readonly kind: 'direct' | 'hop'; readonly transition: JiraTransition }
  | { readonly kind: 'unreachable'; readonly available: readonly string[] }

const order = { new: 0, indeterminate: 1, done: 2 } as const satisfies Record<CategoryKey, number>

/**
 * The next transition towards a target: none when the issue is already there, the best direct transition, else one
 * hop through a status between the current category and the target's (To Do → In Progress → Done, or back), never
 * through a status already visited. The provider asks again from each status it reaches, up to three hops.
 */
const nextTransition = (input: {
  readonly current: JiraStatus
  readonly transitions: readonly JiraTransition[]
  readonly target: { readonly status: Status; readonly label?: string | undefined }
  readonly visited: readonly string[]
}): TransitionStep => {
  const target = input.target
  const current = statusOf(input.current)
  const there =
    target.label === undefined
      ? current.category === target.status || current.equivalents.includes(target.status)
      : normalized(input.current.name) === normalized(target.label)
  if (there) return { kind: 'already' }
  const fresh = input.transitions.filter(transition => !input.visited.some(name => normalized(name) === normalized(transition.to.name)))
  const best = fresh
    .map(transition => ({ transition, score: fit(transition.to, target) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]
  // A project without a Won't Do status keeps a dropped item at Done rather than moving it to another Done status.
  if (target.status === 'dropped' && target.label === undefined && categoryOf(input.current) === 'done' && (best === undefined || best.score < 2))
    return { kind: 'already' }
  if (best !== undefined) return { kind: 'direct', transition: best.transition }
  const from = categoryOf(input.current) ?? 'new'
  const goal = categoryFor(input.target.status)
  const between = fresh.filter(transition => {
    const via = categoryOf(transition.to)
    if (via === undefined) return false
    return order[from] < order[goal] ? order[via] > order[from] && order[via] < order[goal] : order[via] < order[from] && order[via] > order[goal]
  })
  // Then a status of the same category (In Review → In Progress) before one beyond the target (never through Done to reopen).
  const lateral = fresh.find(transition => categoryOf(transition.to) === from)
  // A status of the target's own category that did not fit (a Won't Do for done) is never a stepping stone.
  const hop = between[0] ?? lateral ?? fresh.find(transition => categoryOf(transition.to) !== from && categoryOf(transition.to) !== goal)
  if (hop !== undefined) return { kind: 'hop', transition: hop }
  return { kind: 'unreachable', available: input.transitions.map(transition => transition.to.name) }
}

/** `urgent=Highest, high=High`: the binding's priority names; Jira's defaults otherwise. */
const defaultPriorityNames = { urgent: 'Highest', high: 'High', medium: 'Medium', low: 'Low' } as const satisfies Record<Exclude<Priority, 'none'>, string>
const priorityAliases = {
  urgent: ['highest', 'blocker', 'critical', 'urgent', 'p0'],
  high: ['high', 'major', 'p1'],
  medium: ['medium', 'normal', 'p2'],
  low: ['low', 'lowest', 'minor', 'trivial', 'p3', 'p4'],
} as const satisfies Record<Exclude<Priority, 'none'>, readonly string[]>

const priorityValuesOf = (text: string | undefined): ReadonlyMap<Priority, string> =>
  new Map(
    (text ?? '').split(',').flatMap(pair => {
      const [local, remote] = pair.split('=').map(part => part.trim())
      const priority = BacklogProviders.priorities.find(candidate => candidate === local?.toLowerCase())
      return priority === undefined || remote === undefined || remote === '' ? [] : [[priority, remote] as const]
    }),
  )

const priorityOf = (name: string | undefined, options: ProviderBindingOptions | undefined): Priority => {
  if (name === undefined) return 'none'
  const mapped = [...priorityValuesOf(options?.priorityValues)].find(([, remote]) => normalized(remote) === normalized(name))?.[0]
  if (mapped !== undefined) return mapped
  const key = normalized(name)
  return BacklogProviders.priorities.find(priority => priority !== 'none' && priorityAliases[priority].some(alias => alias === key)) ?? 'none'
}

/** The priority name to write; `none` writes nothing, since most Jira schemes require a priority. */
const priorityNameFor = (priority: Priority, options: ProviderBindingOptions | undefined): string | undefined =>
  priority === 'none' ? undefined : (priorityValuesOf(options?.priorityValues).get(priority) ?? defaultPriorityNames[priority])

/** Jira labels cannot hold spaces: a tag `needs review` is written as `needs-review`. */
const labelsFor = (tags: readonly string[]): string[] => [...new Set(tags.map(tag => tag.trim().replace(/\s+/gu, '-')).filter(tag => tag !== ''))]

/**
 * Issue links in backlog relations, from this issue's side: the link type's outward description names what this
 * issue does to `outwardIssue` (Blocks: this blocks it), its inward one what `inwardIssue` does to this issue.
 */
const linkTypes = { blocks: 'Blocks', 'depends-on': 'Blocks', related: 'Relates', duplicates: 'Duplicate' } as const satisfies Record<Relation, string>

const relationOf = (link: JiraIssueLink): RemoteRelation | undefined => {
  const type = normalized(link.type.name)
  if (type === 'blocks' && link.outwardIssue !== undefined) return { relation: 'blocks', key: link.outwardIssue.id }
  if (type === 'blocks' && link.inwardIssue !== undefined) return { relation: 'depends-on', key: link.inwardIssue.id }
  if (type === 'relates') {
    const other = link.outwardIssue ?? link.inwardIssue
    return other === undefined ? undefined : { relation: 'related', key: other.id }
  }
  if (type === 'duplicate' && link.outwardIssue !== undefined) return { relation: 'duplicates', key: link.outwardIssue.id }
  return undefined
}

/**
 * The `POST /issueLink` body for one relation. Jira creates the link from `inwardIssue` (its source) to `outwardIssue`:
 * `{ type: Blocks, inwardIssue: A, outwardIssue: B }` reads "A blocks B", so this issue goes in `inwardIssue` for
 * blocks and duplicates, and the blocker goes there for depends-on.
 */
const linkRequestFor = (self: string, relation: RemoteRelation) => {
  const type = { name: linkTypes[relation.relation] }
  return relation.relation === 'depends-on'
    ? { type, inwardIssue: { id: relation.key }, outwardIssue: { id: self } }
    : { type, inwardIssue: { id: self }, outwardIssue: { id: relation.key } }
}

const sameRelation = (left: RemoteRelation, right: RemoteRelation): boolean => left.relation === right.relation && left.key === right.key

/** The links to create and the link ids to delete so that the mapped links equal `wanted`; unmapped link types stay. */
const linkChanges = (input: { readonly self: string; readonly current: readonly JiraIssueLink[]; readonly wanted: readonly RemoteRelation[] }) => {
  const mapped = input.current.flatMap(link => {
    const relation = relationOf(link)
    return relation === undefined ? [] : [{ link, relation }]
  })
  return {
    create: input.wanted
      .filter(relation => !mapped.some(entry => sameRelation(entry.relation, relation)))
      .map(relation => linkRequestFor(input.self, relation)),
    remove: mapped.filter(entry => !input.wanted.some(relation => sameRelation(entry.relation, relation))).map(entry => entry.link.id),
  }
}

const criterionLine = /^\s*\[( |x|X)\]\s*(.*)$/u

/** Acceptance criteria from a custom field: each list item (or line) `[x] text`; a task list's DONE items read as met. */
const criteriaOf = (value: string | AdfNode | null | undefined): RemoteCriterion[] => {
  if (value === null || value === undefined) return []
  const lines =
    typeof value === 'string'
      ? value.split('\n').map(line => line.replace(/^\s*[-*+]\s+/u, ''))
      : (value.content ?? []).flatMap(block =>
          block.type === 'bulletList' || block.type === 'orderedList' || block.type === 'taskList'
            ? (block.content ?? []).map(item =>
                item.type === 'taskItem'
                  ? `[${item.attrs?.['state'] === 'DONE' ? 'x' : ' '}] ${JiraAdf.toMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: item.content ?? [] }] }).markdown}`
                  : JiraAdf.toMarkdown({ type: 'doc', content: (item.content ?? []).slice(0, 1) }).markdown.replace(/\\(?=[[\]])/gu, ''),
              )
            : JiraAdf.toMarkdown({ type: 'doc', content: [block] }).markdown.split('\n'),
        )
  return lines.flatMap(line => {
    const match = criterionLine.exec(line)
    const text = (match?.[2] ?? line).trim().slice(0, 500)
    return text === '' ? [] : [{ text, done: match?.[1] !== undefined && match[1] !== ' ' }]
  })
}

/** Acceptance criteria as an ADF bullet list of `[x] text` items, or a plain string for a single-line text field. */
const criteriaValue = (criteria: readonly RemoteCriterion[], asText: boolean): string | AdfNode => {
  const lines = criteria.map(criterion => `[${criterion.done ? 'x' : ' '}] ${criterion.text}`)
  if (asText) return lines.join('\n')
  return {
    version: 1,
    type: 'doc',
    content:
      lines.length === 0
        ? []
        : [
            {
              type: 'bulletList',
              content: lines.map(line => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: line }] }] })),
            },
          ],
  }
}

/** Markdown from a description or textarea field: ADF in Jira Cloud v3, a string in a single-line text field. */
const markdownOf = (value: string | AdfNode | null | undefined) =>
  typeof value === 'string' ? { markdown: value, unsupported: [] } : JiraAdf.toMarkdown(value ?? null)

const issueKeyPattern = /^[A-Z][A-Z0-9_]{0,254}-[1-9]\d{0,17}$/u
const issueIdPattern = /^[1-9]\d{0,17}$/u
const projectKeyPattern = /^[A-Z][A-Z0-9_]{0,254}$/u
const customFieldPattern = /^customfield_\d{1,10}$/u

/** An issue key or id safe to put in a path; anything else is refused before a request is built. */
const issueRef = (value: string): string | undefined => {
  const trimmed = value.trim()
  return issueKeyPattern.test(trimmed) || issueIdPattern.test(trimmed) ? trimmed : undefined
}

const projectKeyOf = (value: string): string | undefined => {
  const trimmed = value.trim().toUpperCase()
  return projectKeyPattern.test(trimmed) ? trimmed : undefined
}

const customFieldOf = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim() ?? ''
  return customFieldPattern.test(trimmed) ? trimmed : undefined
}

/** The issue key a reference names: `KEY-12`, or a `<site>.atlassian.net/browse/KEY-12` (or `?selectedIssue=KEY-12`) URL. */
const keyOfReference = (reference: string): string | undefined => {
  const trimmed = reference.trim()
  if (issueKeyPattern.test(trimmed.toUpperCase())) return trimmed.toUpperCase()
  if (!URL.canParse(trimmed)) return undefined
  const url = new URL(trimmed)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  const fromPath = /\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)\/?$/u.exec(url.pathname)?.[1] ?? /\/issues\/([A-Za-z][A-Za-z0-9_]*-\d+)\/?$/u.exec(url.pathname)?.[1]
  const candidate = (fromPath ?? url.searchParams.get('selectedIssue') ?? '').toUpperCase()
  return issueKeyPattern.test(candidate) ? candidate : undefined
}

/** A JQL date (`yyyy-MM-dd HH:mm`) in the user's time zone: JQL reads dates in the profile time zone, to the minute. */
const jqlDate = (instant: number, timeZone: string): string => {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
  let formatter: Intl.DateTimeFormat
  try {
    formatter = format(timeZone)
  } catch {
    formatter = format('UTC')
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]))
  return `${parts['year'] ?? ''}-${parts['month'] ?? ''}-${parts['day'] ?? ''} ${parts['hour'] ?? ''}:${parts['minute'] ?? ''}`
}

/** Jira timestamps (`2026-01-01T10:00:00.000+0000`) as epoch milliseconds. */
const instantOf = (timestamp: string): number => Date.parse(timestamp.replace(/([+-]\d{2})(\d{2})$/u, '$1:$2')) || 0

/** The search: the project, the binding's own clause, the checkpoint's minute onwards, oldest change first. */
const searchJql = (input: {
  readonly project: string
  readonly extra: string | undefined
  readonly since: string | undefined
  readonly openOnly: boolean
}): string =>
  [
    `project = "${input.project}"`,
    ...(input.extra === undefined || input.extra.trim() === '' ? [] : [`(${input.extra.trim()})`]),
    ...(input.since === undefined ? [] : [`updated >= "${input.since}"`]),
    ...(input.openOnly ? ['statusCategory != Done'] : []),
  ].join(' AND ') + ' ORDER BY updated ASC, key ASC'

/** FNV-1a over the canonical fields, so two edits within the checkpoint's minute still differ. */
const contentHash = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export class JiraMapping {
  static readonly issueSchema = issueSchema
  static readonly transitionSchema = transitionSchema
  static readonly statusOf = statusOf
  static readonly nextTransition = nextTransition
  static readonly priorityOf = priorityOf
  static readonly priorityNameFor = priorityNameFor
  static readonly labelsFor = labelsFor
  static readonly relationOf = relationOf
  static readonly linkChanges = linkChanges
  static readonly criteriaOf = criteriaOf
  static readonly criteriaValue = criteriaValue
  static readonly markdownOf = markdownOf
  static readonly issueRef = issueRef
  static readonly projectKeyOf = projectKeyOf
  static readonly customFieldOf = customFieldOf
  static readonly keyOfReference = keyOfReference
  static readonly jqlDate = jqlDate
  static readonly instantOf = instantOf
  static readonly searchJql = searchJql
  static readonly contentHash = contentHash
}
