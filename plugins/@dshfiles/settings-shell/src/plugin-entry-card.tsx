import { useApi } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { errorMessage, PluginQueryProvider, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@dshfiles/plugin-ui/components/ui/collapsible'
import { ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, useState, type ReactNode } from 'react'
import type { ShellTranslate } from './native/locales.js'
import { rowIdOf, settingsShellApi, type PluginChange, type PluginEntry } from './shell-api.js'

export const PLUGINS_QUERY_KEY = ['settings-shell', 'plugins'] as const

/** What a change's verdict asks of the person, when the switch and the entry's state do not say it already. */
const verdictText = (change: PluginChange, t: ShellTranslate): string | undefined => {
  if (change.application === 'overridden') return t('entryCard.overridden')
  if (change.application === 'failed') return t('entryCard.failed', { reason: change.error ?? '' })
  return undefined
}

const EntryCard = (props: { readonly entry: PluginEntry; readonly t: ShellTranslate }): JSX.Element => {
  const { entry, t } = props
  const api = useApi(settingsShellApi)
  const queryClient = useQueryClient()
  const switchId = useId()
  const change = useMutation({
    mutationFn: (enabled: boolean) => api.setPluginEnabled({ entryId: entry.entryId, enabled }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: PLUGINS_QUERY_KEY }),
  })
  const verdict = change.data === undefined ? undefined : verdictText(change.data, t)
  const dotTone = entry.pendingRestart !== null ? 'warning' : entry.enabled ? 'success' : 'muted'
  return (
    <div
      className="dshx:@container dshx:mt-1 dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:px-3 dshx:py-2"
      data-plugin-entry={entry.entryId}
    >
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-x-3 dshx:gap-y-1.5">
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2.5">
          <StatusDot tone={dotTone} />
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:text-xs dshx:text-muted-foreground">
            <span className="dshx:min-w-0 dshx:truncate">
              <code className="dshx:font-mono dshx:text-foreground">{entry.entryId}</code>
              {' · '}
              {entry.bundle === null ? entry.moduleName : t('entryCard.from', { bundle: entry.bundle })}
            </span>
            {entry.configuredBy.length > 0 && (
              <span className="dshx:min-w-0 dshx:truncate">{t('entryCard.changedBy', { bundles: entry.configuredBy.join(', ') })}</span>
            )}
          </div>
        </div>
        <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2">
          {entry.pendingRestart !== null && (
            <Badge data-pending-restart={entry.pendingRestart} variant="warning">
              {entry.pendingRestart === 'enable' ? t('entryCard.startsAfterRestart') : t('entryCard.stopsAfterRestart')}
            </Badge>
          )}
          <Label className="dshx:text-sm" htmlFor={switchId}>
            {t('entryCard.enabled')}
          </Label>
          <Switch
            checked={entry.enabled}
            disabled={entry.readOnlyReason !== null || change.isPending}
            id={switchId}
            onCheckedChange={enabled => change.mutate(enabled)}
          />
        </div>
      </div>
      {entry.readOnlyReason !== null && (
        <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">{t('entryCard.readOnly', { reason: entry.readOnlyReason })}</p>
      )}
      {entry.seedRegion && <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">{t('entryCard.seedRegion')}</p>}
      {verdict !== undefined && (
        <p className="dshx:m-0 dshx:text-xs dshx:text-destructive" role="status">
          {verdict}
        </p>
      )}
      {change.isError && (
        <p className="dshx:m-0 dshx:text-xs dshx:text-destructive" role="status">
          {errorMessage(change.error, t('entryCard.failed', { reason: '' }))}
        </p>
      )}
    </div>
  )
}

/**
 * The fold around a page's plugin entry. The entry is plumbing (a Loader row id, the bundle behind it and a switch the
 * Plugins page also offers), so it stays one click away instead of heading every settings page; it starts open only
 * when it has something to say. The control is named for its page: a task entry holds several.
 */
export const PluginEntryDisclosure = (props: {
  readonly page: string
  readonly open: boolean
  readonly t: ShellTranslate
  readonly children: ReactNode
}): JSX.Element => {
  const [open, setOpen] = useState(props.open)
  return (
    <Collapsible className="dshx:mt-2 dshx:flex dshx:flex-col" onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger asChild>
        <Button
          aria-label={props.t('entryCard.detailsOf', { page: props.page })}
          className="dshx:-ml-2 dshx:self-start dshx:text-muted-foreground"
          data-plugin-details=""
          size="sm"
          type="button"
          variant="ghost"
        >
          <ChevronRightIcon className={cn('dshx:transition-transform', open && 'dshx:rotate-90')} />
          {props.t('entryCard.details')}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{props.children}</CollapsibleContent>
    </Collapsible>
  )
}

const EntryForNamespace = (props: { readonly namespace: string; readonly page: string; readonly t: ShellTranslate }): JSX.Element | null => {
  const api = useApi(settingsShellApi)
  const plugins = useQuery({
    queryKey: PLUGINS_QUERY_KEY,
    queryFn: ({ signal }) => api.plugins({}, { signal }),
    staleTime: 30_000,
  })
  // A Host without a plugin manager, or one older than these fields, answers an error: the page shows no entry.
  const entry = plugins.data?.entries.find(candidate => rowIdOf(candidate.entryId) === props.namespace)
  if (entry === undefined) return null
  return (
    <PluginEntryDisclosure open={entry.pendingRestart !== null} page={props.page} t={props.t}>
      <EntryCard entry={entry} t={props.t} />
    </PluginEntryDisclosure>
  )
}

/**
 * The Loader entry behind a plugin's settings page: which bundle declares it and which reconfigure it, whether it runs,
 * a change waiting for a restart, and whether `pnpm profile:sync` would undo a change. A dshx plugin's settings
 * namespace is its row id, the last segment of the entry id, so the page finds its entry by it; a namespace no entry carries shows nothing.
 */
export const PluginEntryCard = (props: { readonly namespace: string; readonly page: string; readonly t: ShellTranslate }): JSX.Element => (
  <PluginQueryProvider>
    <EntryForNamespace namespace={props.namespace} page={props.page} t={props.t} />
  </PluginQueryProvider>
)
