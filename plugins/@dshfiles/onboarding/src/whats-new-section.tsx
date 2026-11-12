import { PageSection } from '@dshfiles/plugin-ui/components/page'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { CheckCheckIcon, CopyIcon, ExternalLinkIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import { WhatsNewModel, type Upstream, type WhatsNew, type WhatsNewEntry, type WhatsNewInput } from './whats-new-model.js'

const FIRST_SHOWN = 12

export interface WhatsNewSectionProps {
  readonly loadWhatsNew: (input: WhatsNewInput, signal: AbortSignal) => Promise<WhatsNew>
  readonly lastSeen: string | null
  readonly markSeen: (newest: string) => void
  readonly copy: (text: string) => Promise<boolean>
}

/** A fix or a breaking change says so; a feature needs no badge. Commit types and plugin names stay out of the copy. */
const KIND_LABEL = { feat: null, fix: 'Fix' } as const

const EntryLine = (props: { readonly entry: WhatsNewEntry; readonly isNew: boolean }): ReactNode => {
  const { entry } = props
  const kind = entry.breaking ? 'Breaking change' : KIND_LABEL[entry.kind]
  return (
    <li
      className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-x-2 dshx:gap-y-1 dshx:py-1"
      data-whats-new-entry={entry.commit}
      data-whats-new-plugin={entry.plugin}
      data-new={props.isNew ? '' : undefined}
    >
      {props.isNew ? (
        <Badge className="dshx:font-semibold" variant="secondary">
          New
        </Badge>
      ) : null}
      {kind === null ? null : <Badge variant="muted">{kind}</Badge>}
      <span className="dshx:min-w-0 dshx:flex-1 dshx:text-sm" data-whats-new-summary="">
        {WhatsNewModel.sentence(entry.summary)}
      </span>
      <time className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums" dateTime={entry.date}>
        {entry.date.slice(0, 10)}
      </time>
    </li>
  )
}

/** Changes the remote has and this checkout lacks: a quiet detail, since the fetch status is a maintainer's concern. */
const UpstreamList = (props: { readonly upstream: Upstream; readonly copy: (text: string) => Promise<boolean> }): ReactNode => {
  const [copied, setCopied] = useState(false)
  const target = props.upstream
  const count = `${String(target.entries.length)}${target.more ? '+' : ''}`
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
            <EntryLine entry={entry} isNew={false} key={`${entry.commit}:${entry.plugin}`} />
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
          What's new could not be loaded. Try again; if Getting started was updated since DSH started, restart DSH from the bottom of the rail first.
        </p>
        <div>
          <Button onClick={() => void history.refetch()} size="sm" variant="outline">
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
            <Button onClick={() => void history.refetch()} size="sm" variant="ghost">
              Try again
            </Button>
          ) : null}
        </div>
      </PageSection>
    )

  const view = WhatsNewModel.window({ value, lastSeen: props.lastSeen })
  const newest = view.newest
  const unseen = newest !== null && (props.lastSeen === null || view.newCount > 0)
  const shown = expanded ? view.entries : view.entries.slice(0, FIRST_SHOWN)

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
      meta={view.newCount > 0 ? `${String(view.newCount)} new` : String(value.entries.length)}
    >
      {value.entries.length === 0 ? (
        <p className="dshx:text-sm dshx:text-muted-foreground">Nothing has changed in this setup's history yet.</p>
      ) : (
        <ul aria-label="Changes" className="dshx:flex dshx:flex-col">
          {shown.map(entry => (
            <EntryLine entry={entry} isNew={entry.isNew} key={`${entry.commit}:${entry.plugin}`} />
          ))}
        </ul>
      )}
      {value.entries.length > FIRST_SHOWN ? (
        <div>
          <Button aria-expanded={expanded} onClick={() => setExpanded(!expanded)} size="sm" variant="ghost">
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
