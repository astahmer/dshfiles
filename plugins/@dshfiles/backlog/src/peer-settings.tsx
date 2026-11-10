import { isApiError } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'

import { backlogApi, type BacklogPeerStatusView } from './api.js'
import { ItemGlyphs } from './item-glyphs.js'
import { PeerAutomation, type PeerAutomationView } from './peer-automation.js'

const PEER_STATUS_KEY = ['dshfiles-backlog', 'peer-status'] as const
const THIS_HOST = ''
const HOST_RESTART = 'This DSH Host predates backlog Hosts. Restart the DSH Host process to load them.'

const failureText = (error: unknown, fallback: string): string =>
  isApiError(error) && (error.kind === 'contract' || error.kind === 'unavailable') ? HOST_RESTART : errorMessage(error, fallback)

const pulledAgo = (at: number | null): string => {
  if (at === null) return 'Never pulled'
  const age = ItemGlyphs.ago(at)
  return age === 'now' ? 'Pulled just now' : `Pulled ${age} ago`
}

type PeerView = BacklogPeerStatusView['peers'][number]

/** Where one peer runs automation, in this section's words: on itself, on this Host, or on a Host it names. */
const automationSentence = (entry: { readonly peerName: string; readonly peerHostId: string | null; readonly automation: PeerAutomationView }): string =>
  entry.automation.hostId === entry.peerHostId ? `${entry.peerName} runs automation itself` : `${entry.peerName} runs automation on ${entry.automation.label}`

/** What the section says when Hosts picked different automation Hosts: two of them would run the same gate checks. */
const automationDisagreement = (status: BacklogPeerStatusView): string | null => {
  const disagreements = PeerAutomation.disagreements(status)
  if (disagreements.length === 0) return null
  const where = disagreements.map(automationSentence).join('; ')
  return `Hosts disagree on where automation runs: ${where}. Pick the same Host here and in each Host's Backlog settings › Hosts, or gate checks and main polling run twice.`
}

/** What the section says instead of a Host list when there is nothing to list. */
const emptyNote = (status: BacklogPeerStatusView): string | null => {
  if (!status.available)
    return 'Multi-host is not loaded, so this backlog stays on this Host. Enable @dshfiles/multi-host and add a Host in the Hosts panel to share it.'
  if (status.peers.length === 0) return 'No other Host yet. Add one in the Hosts panel, then turn it on here.'
  return null
}

const PeerRow = (props: {
  readonly peer: PeerView
  readonly automation: PeerAutomationView | null
  readonly busy: boolean
  readonly onToggle: (enabled: boolean) => void
  readonly onSync: () => void
}) => {
  const { peer } = props
  return (
    <li className="dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-lg dshx:border dshx:border-border dshx:p-3" aria-label={`Host ${peer.name}`}>
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2">
        <span className={cn('dshx:size-2 dshx:rounded-full', peer.connected ? 'dshx:bg-success' : 'dshx:bg-muted-foreground')} aria-hidden />
        <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium">{peer.name}</span>
        {peer.enabled ? (
          <span className="dshx:text-xs dshx:text-muted-foreground">
            {pulledAgo(peer.lastPullAt)}
            {peer.lag > 0 ? ` · ${String(peer.lag)} ops to pull` : ''}
          </span>
        ) : null}
        <span className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-2">
          <Button type="button" size="xs" variant="ghost" disabled={!peer.enabled || props.busy} onClick={props.onSync}>
            <RefreshCwIcon aria-hidden className={cn('dshx:size-3', props.busy && 'dshx:animate-spin')} />
            Sync now
          </Button>
          <Switch size="sm" checked={peer.enabled} aria-label={`Share the backlog with ${peer.name}`} onCheckedChange={props.onToggle} />
        </span>
      </div>
      <p className="dshx:text-xs dshx:text-muted-foreground">
        {props.automation === null ? 'Automation Host not reported yet' : `Automation on ${props.automation.label}`}
      </p>
      {peer.error === null ? null : (
        <p role="alert" className="dshx:text-xs dshx:text-destructive">
          {peer.error.message}
        </p>
      )}
    </li>
  )
}

/** Settings › Hosts: which multi-host runtimes share this backlog, how far each was pulled, and which Host runs automation. */
export const BacklogHostsSettings = (): JSX.Element => {
  const api = useApi(backlogApi)
  const client = useQueryClient()
  const status = useQuery({ queryKey: PEER_STATUS_KEY, queryFn: () => api.peerStatus(), staleTime: 10_000, refetchInterval: 30_000 })
  const store = (next: BacklogPeerStatusView) => client.setQueryData(PEER_STATUS_KEY, next)
  const sync = useMutation({ mutationFn: (runtimeId?: string) => api.peerSync(runtimeId === undefined ? {} : { runtimeId }), onSuccess: store })
  const configure = useMutation({ mutationFn: (input: Parameters<typeof api.configurePeers>[0]) => api.configurePeers(input), onSuccess: store })
  const data = status.data
  const disagreement = data === undefined ? null : automationDisagreement(data)
  const enabledCount = data?.peers.filter(peer => peer.enabled).length ?? 0
  const automationOptions: ComboboxOption[] = [
    { value: THIS_HOST, label: 'This Host' },
    ...(data?.peers ?? []).flatMap(peer => (peer.remoteHostId === null ? [] : [{ value: peer.remoteHostId, label: peer.name }])),
  ]
  const mutationError = configure.error ?? sync.error
  return (
    <section
      className="dshx-root dshx:@container dshx:mx-auto dshx:w-full dshx:max-w-2xl dshx:p-5 dshx:@max-pane-narrow:p-3"
      aria-labelledby="backlog-hosts-title"
    >
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <h3 id="backlog-hosts-title" className="dshx:text-base dshx:font-semibold">
          Hosts
        </h3>
        {enabledCount > 0 ? (
          <Button type="button" size="xs" variant="outline" className="dshx:ml-auto" disabled={sync.isPending} onClick={() => sync.mutate(undefined)}>
            <RefreshCwIcon aria-hidden className={cn('dshx:size-3', sync.isPending && 'dshx:animate-spin')} />
            Sync all
          </Button>
        ) : null}
      </div>
      {status.error === null ? null : (
        <p role="alert" className="dshx:mt-3 dshx:text-sm dshx:text-warning">
          {failureText(status.error, 'Hosts could not be read. Retry.')}
        </p>
      )}
      {data === undefined ? null : emptyNote(data) !== null ? (
        <p className="dshx:mt-3 dshx:text-sm dshx:text-muted-foreground">{emptyNote(data)}</p>
      ) : (
        <div className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-3">
          <ul className="dshx:flex dshx:flex-col dshx:gap-2">
            {data.peers.map(peer => (
              <PeerRow
                key={peer.runtimeId}
                peer={peer}
                automation={PeerAutomation.of(data, peer)}
                busy={sync.isPending && (sync.variables === undefined || sync.variables === peer.runtimeId)}
                onToggle={enabled => configure.mutate({ peers: [{ runtimeId: peer.runtimeId, enabled }] })}
                onSync={() => sync.mutate(peer.runtimeId)}
              />
            ))}
          </ul>
          {enabledCount > 0 ? (
            <div className="dshx:flex dshx:flex-col dshx:gap-1">
              <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-sm">
                <span>Automation runs on</span>
                <Combobox
                  label="Automation Host"
                  value={data.automationHostId ?? THIS_HOST}
                  options={automationOptions}
                  disabled={configure.isPending}
                  onValueChange={value => configure.mutate({ automationHost: value })}
                  triggerClassName="dshx:min-w-0 dshx:max-w-56"
                />
              </div>
              {data.automationNote === null ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{data.automationNote}</p>}
              {disagreement === null ? null : (
                <p role="status" className="dshx:text-xs dshx:text-warning">
                  {disagreement}
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}
      {mutationError === null ? null : (
        <p role="alert" className="dshx:mt-2 dshx:text-xs dshx:text-destructive">
          {failureText(mutationError, 'The change was not saved. Retry.')}
        </p>
      )}
    </section>
  )
}
