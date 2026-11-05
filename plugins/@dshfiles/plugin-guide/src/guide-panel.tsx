import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { Page } from '@dshfiles/plugin-ui/components/page'
import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { SearchInput } from '@dshfiles/plugin-ui/components/ui/search-input'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { CopyIcon, MessageSquarePlusIcon, TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import { pluginGuideApi } from './api.js'
import { GUIDE_KINDS, KIND_LABEL, PluginGuide, RISK_LABEL, type GuideCatalog, type GuideEntry, type GuideKind } from './catalog-model.js'

const RISK_VARIANT = { additive: 'success', 'id-reuse-replaces': 'warning', replaces: 'warning', 'shell-owned': 'destructive' } as const

export interface PluginGuidePanelProps {
  /** Open a new thread whose composer holds `text`; it is never sent from here. */
  readonly draftForAgent: (text: string) => void
}

const Field = (props: { readonly label: string; readonly children: ReactNode; readonly mono?: boolean }): ReactNode => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
    <dt className="dshx:text-xs dshx:text-muted-foreground">{props.label}</dt>
    <dd className={cn('dshx:min-w-0 dshx:text-sm dshx:break-words', props.mono === true && 'dshx:font-mono dshx:text-xs')}>{props.children}</dd>
  </div>
)

const Detail = (props: { readonly entry: GuideEntry; readonly catalog: GuideCatalog; readonly draftForAgent: (text: string) => void }): ReactNode => {
  const { entry } = props
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (label: string, text: string) => () => {
    void writeClipboard(text).then(() => setCopied(label))
  }
  return (
    <section
      aria-label={`${entry.title} details`}
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:border-border dshx:p-4"
    >
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2">
        <h2 className="dshx:min-w-0 dshx:font-mono dshx:text-base dshx:font-semibold dshx:break-all">{entry.title}</h2>
        <Badge variant={RISK_VARIANT[entry.risk]} data-risk={entry.risk}>
          {entry.risk === 'shell-owned' ? <TriangleAlertIcon aria-hidden /> : null}
          {RISK_LABEL[entry.risk]}
        </Badge>
        <Badge variant="muted">{KIND_LABEL[entry.kind]}</Badge>
      </div>
      <p className="dshx:text-sm">{entry.summary}</p>
      <p className={cn('dshx:text-xs', entry.risk === 'additive' ? 'dshx:text-muted-foreground' : 'dshx:text-warning')}>{entry.riskNote}</p>
      <dl className="dshx:grid dshx:grid-cols-2 dshx:gap-3 dshx:@max-pane-narrow:grid-cols-1">
        <Field label="Symbol" mono>
          {entry.publicSymbol}
        </Field>
        <Field label="Import" mono>
          {entry.importFrom}
        </Field>
        <Field label="Owner">{entry.owner}</Field>
        <Field label="Scope · mode">
          {entry.scope} · {entry.mode}
        </Field>
        <Field label="Registration" mono>
          {entry.registration}
        </Field>
        <Field label="Occupancy">
          <span data-occupancy={entry.occupancy}>
            {entry.occupancy === 'static' ? `Static (build time): ${entry.occupants.join(', ') || 'none recorded'}` : 'Unavailable'} · not live
          </span>
        </Field>
        <Field label="Source" mono>
          {entry.source}
        </Field>
        {entry.docs === null ? null : (
          <Field label="Docs" mono>
            {entry.docs}
          </Field>
        )}
      </dl>
      {entry.details.length === 0 ? null : (
        <ul className="dshx:flex dshx:list-disc dshx:flex-col dshx:gap-1 dshx:pl-5 dshx:text-xs dshx:text-muted-foreground">
          {entry.details.map(detail => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
      <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
        <Button onClick={() => props.draftForAgent(PluginGuide.draft(entry, props.catalog))} size="sm" variant="outline">
          <MessageSquarePlusIcon /> Draft for agent
        </Button>
        <Button onClick={copy('guidance', PluginGuide.draft(entry, props.catalog))} size="sm" variant="ghost">
          <CopyIcon /> {copied === 'guidance' ? 'Copied' : 'Copy guidance'}
        </Button>
        {entry.command === null ? null : (
          <Button aria-label={`Copy ${entry.command}`} onClick={copy('command', entry.command)} size="sm" variant="ghost">
            <CopyIcon /> <span className="dshx:min-w-0 dshx:truncate dshx:font-mono! dshx:text-xs">{copied === 'command' ? 'Copied' : entry.command}</span>
          </Button>
        )}
      </div>
    </section>
  )
}

export const PluginGuidePanel = (props: PluginGuidePanelProps): ReactNode => {
  const api = useApi(pluginGuideApi)
  const guide = useQuery({ queryKey: ['plugin-guide', 'catalog'], queryFn: ({ signal }) => api.catalog({}, { signal }), staleTime: Infinity, retry: false })
  const [kind, setKind] = useState<GuideKind | 'all'>('all')
  const [search, setSearch] = useState('')
  const query = useDebouncedValue({ value: search, delayMs: 150 })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const catalog = guide.data?.catalog
  const freshness = guide.data?.freshness
  const matches = catalog === undefined ? [] : PluginGuide.matching(catalog, { query, kind: kind === 'all' ? undefined : kind })
  const selected = matches.find(entry => entry.key === selectedKey) ?? matches[0]

  return (
    <main aria-label="Plugin guide" className="dshx-root dshx:h-full">
      <Page
        scroll
        heading="Plugin guide"
        description="Where a DSH plugin can extend the app, what each surface adds or replaces, and where its contract is declared."
        meta={catalog === undefined ? null : <Badge variant="muted">Static catalog · DSH {catalog.dshVersion}</Badge>}
      >
        {guide.isError ? (
          <Alert variant="destructive">
            <AlertTitle>The guide catalog could not be read</AlertTitle>
            <AlertDescription>
              {isApiOwnerMissing(guide.error)
                ? 'The Plugin Guide Host half is not running. Restart DSH after adding @dshfiles/plugin-guide to the profile.'
                : 'Reload the page; if it keeps failing, rebuild @dshfiles/plugin-guide and restart DSH.'}
            </AlertDescription>
          </Alert>
        ) : null}
        {freshness?.stale === true ? (
          <Alert data-guide-stale>
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>Parts of this catalog may be out of date</AlertTitle>
            <AlertDescription>
              <ul className="dshx:flex dshx:flex-col dshx:gap-1">
                {freshness.reasons.map(reason => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        <p className="dshx:text-xs dshx:text-muted-foreground">
          Occupancy is a build-time snapshot or unavailable, never live. For a running DSH use{' '}
          <code className="dshx:font-mono">dshx inspect slots --root &lt;slot&gt;</code>.
        </p>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <SearchInput
            aria-label="Search extension surfaces"
            className="dshx:w-72 dshx:max-w-full"
            onChange={event => setSearch(event.target.value)}
            placeholder="Search slots, registries, APIs…"
            value={search}
          />
        </div>
        <div
          aria-label="Surface kinds"
          className="dshx:flex dshx:flex-wrap dshx:gap-1.5 dshx:@max-pane-narrow:flex-nowrap dshx:@max-pane-narrow:overflow-x-auto"
          role="group"
        >
          {(['all', ...GUIDE_KINDS] as const).map(candidate => {
            const count =
              catalog === undefined ? 0 : candidate === 'all' ? catalog.entries.length : catalog.entries.filter(entry => entry.kind === candidate).length
            return (
              <Button
                aria-pressed={kind === candidate}
                className="dshx:shrink-0"
                key={candidate}
                onClick={() => setKind(candidate)}
                size="sm"
                variant={kind === candidate ? 'secondary' : 'ghost'}
              >
                {candidate === 'all' ? 'All' : KIND_LABEL[candidate]}
                <span className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">{count}</span>
              </Button>
            )
          })}
        </div>
        {catalog === undefined ? null : (
          <div className="dshx:grid dshx:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] dshx:gap-4 dshx:@max-pane-compact:grid-cols-1">
            <ul
              aria-label="Extension surfaces"
              className="dshx:flex dshx:max-h-[70vh] dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto dshx:@max-pane-compact:max-h-64"
            >
              {matches.length === 0 ? (
                <li className="dshx:p-2 dshx:text-sm dshx:text-muted-foreground">Nothing matches. Clear the search or pick All.</li>
              ) : null}
              {matches.map(entry => (
                <li key={entry.key}>
                  <button
                    aria-current={selected?.key === entry.key ? 'true' : undefined}
                    className={cn(
                      'dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:items-start dshx:rounded-md dshx:px-2 dshx:py-1.5 dshx:text-left dshx:hover:bg-accent',
                      selected?.key === entry.key && 'dshx:bg-accent',
                    )}
                    onClick={() => setSelectedKey(entry.key)}
                    type="button"
                  >
                    <span className="dshx:flex dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-1.5">
                      <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs">{entry.title}</span>
                      {entry.risk === 'shell-owned' ? (
                        <TriangleAlertIcon aria-label="Shell-owned" className="dshx:size-3.5 dshx:shrink-0 dshx:text-destructive" />
                      ) : null}
                    </span>
                    <span className="dshx:w-full dshx:min-w-0 dshx:truncate dshx:text-xs dshx:text-muted-foreground">{entry.owner}</span>
                  </button>
                </li>
              ))}
            </ul>
            {selected === undefined ? null : <Detail catalog={catalog} draftForAgent={props.draftForAgent} entry={selected} />}
          </div>
        )}
      </Page>
    </main>
  )
}
