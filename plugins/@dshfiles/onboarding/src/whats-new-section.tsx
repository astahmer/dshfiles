import { PageSection } from '@dshfiles/plugin-ui/components/page'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { CheckCheckIcon, CopyIcon, ExternalLinkIcon, ListIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import { TOUCH } from './touch.js'
import { WhatsNewModel, type Upstream, type WhatsNew, type WhatsNewEntry, type WhatsNewInput } from './whats-new-model.js'

const FIRST_SHOWN = 12

export interface WhatsNewSectionProps {
  readonly loadWhatsNew: (input: WhatsNewInput, signal: AbortSignal) => Promise<WhatsNew>
  readonly lastSeen: string | null
  readonly markSeen: (newest: string) => void
  readonly copy: (text: string) => Promise<boolean>
  /** Narrow Getting started's features to one plugin. */
  readonly showFeatures: (plugin: string) => void
}

const EntryLine = (props: { readonly entry: WhatsNewEntry; readonly isNew: boolean; readonly showPlugin: boolean }): ReactNode => {
  const { entry } = props
  return (
    <li
      className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-x-2 dshx:gap-y-1 dshx:py-1"
      data-whats-new-entry={entry.commit}
      data-new={props.isNew ? '' : undefined}
    >
      <Badge variant={entry.kind === 'feat' ? 'info' : 'muted'}>{entry.breaking ? `${entry.kind}!` : entry.kind}</Badge>
      {props.isNew ? <Badge variant="success">New</Badge> : null}
      {props.showPlugin ? <span className="dshx:text-xs dshx:text-muted-foreground">{entry.plugin}</span> : null}
      <span className="dshx:min-w-0 dshx:flex-1 dshx:text-sm">{entry.summary}</span>
      <time className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums" dateTime={entry.date}>
        {entry.date.slice(0, 10)}
      </time>
    </li>
  )
}

const UpstreamList = (props: { readonly upstream: Upstream; readonly copy: (text: string) => Promise<boolean> }): ReactNode => {
  const [copied, setCopied] = useState(false)
  const target = props.upstream
  return (
    <section
      aria-label={`${target.bookmark}@${target.remote}`}
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:rounded-lg dshx:border dshx:border-border dshx:p-3"
      data-whats-new-upstream={target.remote}
    >
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-x-2">
        <h3 className="dshx:min-w-0 dshx:text-sm dshx:font-semibold dshx:break-all">
          {target.bookmark}@{target.remote}
        </h3>
        <span className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">
          {String(target.entries.length)}
          {target.more ? '+' : ''} not in your {target.bookmark}, as of the last fetch
        </span>
      </div>
      {target.entries.length === 0 ? null : (
        <ul className="dshx:flex dshx:flex-col">
          {target.entries.map(entry => (
            <EntryLine entry={entry} isNew={false} key={`${entry.commit}:${entry.plugin}`} showPlugin />
          ))}
        </ul>
      )}
      <div>
        <Button
          aria-label={`Copy ${target.fetchCommand}`}
          className={cn('dshx:shrink', TOUCH)}
          onClick={async () => setCopied(await props.copy(target.fetchCommand))}
          size="sm"
          variant="ghost"
        >
          <CopyIcon /> <code className="dshx:font-mono!">{copied ? 'Copied' : target.fetchCommand}</code>
        </Button>
      </div>
    </section>
  )
}

const CommitsLink = (props: { readonly href: string }): ReactNode => (
  <Button asChild className={TOUCH} size="sm" variant="outline">
    <a href={props.href} rel="noopener noreferrer" target="_blank">
      <ExternalLinkIcon /> Open the commits on GitHub
    </a>
  </Button>
)

/** Changes to owned plugins from the checkout's history, read only while this section is on screen. */
export const WhatsNewSection = (props: WhatsNewSectionProps): ReactNode => {
  const [expanded, setExpanded] = useState(false)
  const history = useQuery({
    queryKey: ['onboarding', 'whats-new'],
    queryFn: ({ signal }) => props.loadWhatsNew({}, signal),
    retry: false,
    staleTime: 60_000,
  })
  const value = history.data

  if (history.isError)
    return (
      <PageSection data-whats-new="error" heading="What's new">
        <p className="dshx:text-sm dshx:text-muted-foreground">
          What's new could not read this Host. If onboarding was updated since DSH started, restart DSH; otherwise check that the plugin is enabled in Settings
          › Plugins, then try again.
        </p>
        <div>
          <Button className={TOUCH} onClick={() => void history.refetch()} size="sm" variant="outline">
            Try again
          </Button>
        </div>
      </PageSection>
    )
  if (value === undefined || value.state === 'off') return null
  if (value.state !== 'ready')
    return (
      <PageSection data-whats-new={value.state} heading="What's new">
        <p className="dshx:text-sm dshx:text-muted-foreground">{value.reason}</p>
        <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
          <CommitsLink href={value.commitsUrl} />
          {value.state === 'unreadable' ? (
            <Button className={TOUCH} onClick={() => void history.refetch()} size="sm" variant="ghost">
              Try again
            </Button>
          ) : null}
        </div>
      </PageSection>
    )

  const view = WhatsNewModel.window({ value, lastSeen: props.lastSeen })
  const newest = view.newest
  const unseen = newest !== null && (props.lastSeen === null || view.newCount > 0)
  let budget = expanded ? Number.POSITIVE_INFINITY : FIRST_SHOWN
  const groups = view.groups.flatMap(group => {
    if (budget <= 0) return []
    const entries = group.entries.slice(0, budget)
    budget -= entries.length
    return [{ ...group, entries }]
  })
  const hidden = value.entries.length - groups.reduce((sum, group) => sum + group.entries.length, 0)

  return (
    <PageSection
      actions={
        unseen ? (
          <Button className={TOUCH} onClick={() => props.markSeen(newest)} size="sm" variant="outline">
            <CheckCheckIcon /> Mark as seen
          </Button>
        ) : null
      }
      data-whats-new="ready"
      heading="What's new"
      meta={view.newCount > 0 ? `${String(view.newCount)} new` : String(value.entries.length)}
    >
      {value.entries.length === 0 ? (
        <p className="dshx:text-sm dshx:text-muted-foreground">No feat or fix change to an owned plugin in this history yet.</p>
      ) : (
        <ul aria-label="Changes by plugin" className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">
          {groups.map(group => (
            <li className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:py-2" data-whats-new-plugin={group.plugin} key={group.plugin}>
              <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-start dshx:gap-x-3 dshx:gap-y-1">
                <div className="dshx:min-w-0 dshx:flex-1">
                  <h3 className="dshx:text-sm dshx:font-semibold">{group.plugin}</h3>
                  <p className="dshx:line-clamp-2 dshx:text-xs dshx:text-muted-foreground">{group.description}</p>
                </div>
                {group.features > 0 ? (
                  <Button
                    aria-label={`Features of ${group.plugin}`}
                    className={cn('dshx:shrink-0', TOUCH)}
                    onClick={() => props.showFeatures(group.plugin)}
                    size="sm"
                    variant="ghost"
                  >
                    <ListIcon /> Features
                  </Button>
                ) : null}
              </div>
              <ul className="dshx:flex dshx:flex-col">
                {group.entries.map(entry => (
                  <EntryLine entry={entry} isNew={entry.isNew} key={entry.commit} showPlugin={false} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 || (expanded && value.entries.length > FIRST_SHOWN) ? (
        <div>
          <Button aria-expanded={expanded} className={TOUCH} onClick={() => setExpanded(!expanded)} size="sm" variant="ghost">
            {expanded ? 'Show fewer' : `Show all ${String(value.entries.length)}`}
          </Button>
        </div>
      ) : null}
      {value.upstream
        .flatMap(target => (target.entries.length === 0 ? [] : [target]))
        .map(target => (
          <UpstreamList copy={props.copy} key={target.remote} upstream={target} />
        ))}
    </PageSection>
  )
}
