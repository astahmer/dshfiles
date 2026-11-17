import { PageSection } from '@dshfiles/plugin-ui/components/page'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { CheckCheckIcon, CopyIcon, ExternalLinkIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import { WhatsNewModel, type Upstream, type WhatsNew, type WhatsNewEntry, type WhatsNewInput } from './whats-new-model.js'

export interface WhatsNewSectionProps {
  readonly loadWhatsNew: (input: WhatsNewInput, signal: AbortSignal) => Promise<WhatsNew>
  readonly lastSeen: string | null
  readonly markSeen: (newest: string) => void
  readonly copy: (text: string) => Promise<boolean>
}

/**
 * The one chip a line may carry, in its own column: a breaking change, a fix, or New since the last visit. A feature
 * needs none. Commit types and plugin names stay out of the copy.
 */
const chipOf = (entry: WhatsNewEntry, isNew: boolean): { readonly label: string; readonly strong: boolean } | null => {
  if (entry.breaking) return { label: 'Breaking', strong: true }
  if (isNew) return { label: entry.kind === 'fix' ? 'New fix' : 'New', strong: true }
  return entry.kind === 'fix' ? { label: 'Fix', strong: false } : null
}

const EntryLine = (props: { readonly entry: WhatsNewEntry; readonly isNew: boolean; readonly now: Date; readonly chipColumn: boolean }): ReactNode => {
  const { entry } = props
  const chip = chipOf(entry, props.isNew)
  return (
    <li
      className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2 dshx:py-1"
      data-whats-new-entry={entry.commit}
      data-whats-new-plugin={entry.plugin}
      data-new={props.isNew ? '' : undefined}
    >
      {/* While any line of the list has a chip, every line reserves its column: the sentences start on one edge. */}
      {props.chipColumn ? (
        <span className="dshx:flex dshx:w-16 dshx:shrink-0" data-whats-new-chip="">
          {chip === null ? null : (
            <Badge className={chip.strong ? 'dshx:font-semibold' : undefined} variant={chip.strong ? 'secondary' : 'muted'}>
              {chip.label}
            </Badge>
          )}
        </span>
      ) : null}
      <span className="dshx:min-w-0 dshx:flex-1 dshx:text-sm" data-whats-new-summary="">
        {WhatsNewModel.sentence(entry.summary)}
      </span>
      <time className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums" dateTime={entry.date}>
        {WhatsNewModel.dateLabel(entry.date, props.now)}
      </time>
    </li>
  )
}

/** Changes the remote has and this checkout lacks: a quiet detail, since the fetch status is a maintainer's concern. */
const UpstreamList = (props: { readonly upstream: Upstream; readonly copy: (text: string) => Promise<boolean> }): ReactNode => {
  const [copied, setCopied] = useState(false)
  const [now] = useState(() => new Date())
  const target = props.upstream
  const count = `${String(target.entries.length)}${target.more ? '+' : ''}`
  const upstreamChips = target.entries.some(entry => chipOf(entry, false) !== null)
  return (
    <details className="dshx:min-w-0 dshx:text-xs dshx:text-muted-foreground" data-whats-new-upstream={target.remote}>
      <summary className="dshx:cursor-pointer dshx:rounded-sm dshx:py-1 dshx:tabular-nums dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring">
        {count} newer {target.entries.length === 1 && !target.more ? 'change' : 'changes'} not in your copy yet
      </summary>
      <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1 dshx:pt-1">
        <p className="dshx:break-all">
          On {target.bookmark}@{target.remote} as of the last fetch.
        </p>
        <ul className="dshx:flex dshx:flex-col dshx:text-foreground">
          {target.entries.map(entry => (
            <EntryLine chipColumn={upstreamChips} entry={entry} isNew={false} key={`${entry.commit}:${entry.plugin}`} now={now} />
          ))}
        </ul>
        <div>
          <Button
            aria-label={`Copy ${target.fetchCommand}`}
            className="dshx:shrink"
            onClick={async () => setCopied(await props.copy(target.fetchCommand))}
            size="sm"
            variant="ghost"
          >
            <CopyIcon /> <code className="dshx:font-mono!">{copied ? 'Copied' : target.fetchCommand}</code>
          </Button>
        </div>
      </div>
    </details>
  )
}

const CommitsLink = (props: { readonly href: string }): ReactNode => (
  <Button asChild size="sm" variant="outline">
    <a href={props.href} rel="noopener noreferrer" target="_blank">
      <ExternalLinkIcon /> Open the commits on GitHub
    </a>
  </Button>
)

/** Changes to owned plugins from the checkout's history, read only while this section is on screen. */
export const WhatsNewSection = (props: WhatsNewSectionProps): ReactNode => {
  const [expanded, setExpanded] = useState(false)
  const [now] = useState(() => new Date())
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
          What's new could not be loaded. Try again; if Getting started was updated since DSH started, restart DSH first (the status bar shows Restart DSH while
          an update waits).
        </p>
        <div>
          <Button onClick={() => void history.refetch()} size="sm" variant="outline">
            Retry
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
            <Button onClick={() => void history.refetch()} size="sm" variant="ghost">
              Retry
            </Button>
          ) : null}
        </div>
      </PageSection>
    )

  const view = WhatsNewModel.window({ value, lastSeen: props.lastSeen })
  const newest = view.newest
  const unseen = newest !== null && (props.lastSeen === null || view.newCount > 0)
  // What was added leads, five at most; every change, fixes included, is one click away.
  const featured = WhatsNewModel.featured(view.entries)
  const shown = expanded ? view.entries : featured
  const hidden = view.entries.length - featured.length
  const chipColumn = shown.some(entry => chipOf(entry, entry.isNew) !== null)

  return (
    <PageSection
      actions={
        unseen ? (
          <Button onClick={() => props.markSeen(newest)} size="sm" variant="outline">
            <CheckCheckIcon /> Mark as seen
          </Button>
        ) : null
      }
      data-whats-new="ready"
      heading="What's new"
      {...(view.newCount > 0 ? { meta: `${String(view.newCount)} new` } : undefined)}
    >
      {value.entries.length === 0 ? (
        <p className="dshx:text-sm dshx:text-muted-foreground">Nothing has changed in this setup's history yet.</p>
      ) : shown.length === 0 ? (
        <p className="dshx:text-sm dshx:text-muted-foreground">No new feature lately; the latest changes are fixes.</p>
      ) : (
        <ul aria-label="Changes" className="dshx:flex dshx:flex-col">
          {shown.map(entry => (
            <EntryLine chipColumn={chipColumn} entry={entry} isNew={entry.isNew} key={`${entry.commit}:${entry.plugin}`} now={now} />
          ))}
        </ul>
      )}
      {hidden > 0 ? (
        <div>
          <Button aria-expanded={expanded} onClick={() => setExpanded(!expanded)} size="sm" variant="ghost">
            {expanded ? 'Show features only' : `Show all ${String(view.entries.length)} changes`}
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
