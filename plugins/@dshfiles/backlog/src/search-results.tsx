import { SearchIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ReactNode } from 'react'

import type { BacklogSummaryView } from './api.js'
import { BacklogItemMenu } from './item-actions-menu.js'
import { ItemGlyphs } from './item-glyphs.js'
import type { StartThreadItem } from './start-thread.js'
import { useBacklogActions } from './use-backlog-actions.js'

type MatchField = NonNullable<BacklogSummaryView['match']>['fields'][number]

const fieldLabels = {
  id: 'id',
  title: 'title',
  tag: 'tag',
  body: 'description',
  comment: 'comment',
  link: 'link',
  project: 'project',
  capture: 'original capture',
} satisfies Record<MatchField, string>

/** The free-text words of a query (operators dropped), for highlighting. */
const termsOf = (query: string): string[] =>
  [...query.toLowerCase().matchAll(/"([^"]+)"|(\S+)/g)]
    .map(match => match[1] ?? match[2] ?? '')
    .filter(term => term !== '' && !term.startsWith('#') && !/^[a-z]+:/.test(term))

const Highlight = (props: { readonly text: string; readonly terms: readonly string[] }): ReactNode => {
  if (props.terms.length === 0) return props.text
  const pattern = new RegExp(`(${props.terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return props.text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      <mark key={String(index)} className="dshx:rounded-sm dshx:bg-warning/25 dshx:px-0.5 dshx:text-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

/** Results ranked by the Host, each saying where it matched; dormant and archived history is included and labelled. */
export const SearchResults = (props: {
  readonly items: readonly BacklogSummaryView[]
  readonly total: number
  readonly query: string
  readonly openId: number | null
  readonly cursorId: number | null
  readonly select: (id: number) => void
  readonly hover: (id: number) => void
  readonly loaded: boolean
  readonly startThread: (items: readonly StartThreadItem[]) => void
  readonly projectPaths: readonly string[]
}): JSX.Element => {
  const terms = termsOf(props.query)
  const actions = useBacklogActions()
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
      <div className="dshx:flex dshx:h-10 dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4 dshx:text-xs dshx:text-muted-foreground">
        <SearchIcon aria-hidden className="dshx:size-3.5" />
        <span>
          <span className="dshx:tabular-nums dshx:text-foreground">{props.total}</span> {props.total === 1 ? 'result' : 'results'}, best match first
        </span>
        <span className="dshx:ml-auto dshx:hidden dshx:@min-[48rem]:inline">
          Try <code>is:blocked</code> <code>kind:bug</code> <code>#tag</code> <code>project:</code> <code>has:thread</code> <code>by:agent</code>{' '}
          <code>updated:&lt;7d</code>
        </span>
      </div>
      <ul aria-label="Search results" className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto">
        {props.loaded && props.items.length === 0 ? (
          <li className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-2 dshx:py-20 dshx:text-center">
            <SearchIcon aria-hidden className="dshx:size-7 dshx:text-muted-foreground" />
            <p className="dshx:text-sm dshx:font-medium">No match</p>
            <p className="dshx:text-xs dshx:text-muted-foreground">Search covers titles, descriptions, comments, tags, links and archived items.</p>
          </li>
        ) : null}
        {props.items.map(item => (
          <BacklogItemMenu
            key={item.id}
            item={item}
            projectPaths={props.projectPaths}
            update={input => actions.update.mutate(input)}
            triage={id => actions.triage.mutate(id)}
            startThread={props.startThread}
            openItem={props.select}
          >
            <li
              aria-label={`Item b:${String(item.id)}`}
              onClick={() => props.select(item.id)}
              onMouseMove={() => props.hover(item.id)}
              className={cn(
                'dshx:flex dshx:cursor-default dshx:flex-col dshx:gap-1 dshx:border-b dshx:border-border/50 dshx:px-4 dshx:py-2.5 dshx:transition-colors',
                item.id === props.openId ? 'dshx:bg-accent/80' : item.id === props.cursorId ? 'dshx:bg-accent/45' : 'dshx:hover:bg-accent/30',
              )}
            >
              <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:text-[13px]">
                <ItemGlyphs.StatusIcon status={item.status} />
                <span className="dshx:w-10 dshx:shrink-0 dshx:font-mono! dshx:text-[11px] dshx:text-muted-foreground">b:{item.id}</span>
                <span className="dshx:min-w-0 dshx:truncate dshx:font-medium">
                  <Highlight text={item.title} terms={terms} />
                </span>
                <ItemGlyphs.AttentionBadge attention={item.attention} compact />
                {item.freshness === 'fresh' ? null : (
                  <span className="dshx:shrink-0 dshx:rounded-full dshx:bg-muted dshx:px-1.5 dshx:text-[11px] dshx:text-muted-foreground">
                    {item.freshness}
                  </span>
                )}
                <span className="dshx:ml-auto dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground">
                  {item.project === null ? null : (
                    <>
                      <ItemGlyphs.ProjectLabel project={item.project} />·
                    </>
                  )}
                  {ItemGlyphs.ago(item.lastActivityAt)}
                </span>
              </div>
              {item.match === null ? null : (
                <div className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2 dshx:pl-[66px] dshx:text-xs">
                  <span className="dshx:shrink-0 dshx:text-muted-foreground">in {item.match.fields.map(field => fieldLabels[field]).join(', ')}</span>
                  {item.match.snippet === null ? null : (
                    <span className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground">
                      <Highlight text={item.match.snippet} terms={terms} />
                    </span>
                  )}
                </div>
              )}
            </li>
          </BacklogItemMenu>
        ))}
      </ul>
    </div>
  )
}
