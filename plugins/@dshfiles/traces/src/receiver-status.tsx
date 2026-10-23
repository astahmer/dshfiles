import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ExternalLinkIcon } from '@dshfiles/plugin-ui/icons'
import type { TracesTranslate } from './locales.js'
import type { ReceiverStatus } from './types.js'

export const receiverEndpoint = (status: ReceiverStatus): string | null =>
  status.boundPort === null ? null : `http://${status.address.includes(':') ? `[${status.address}]` : status.address}:${String(status.boundPort)}`

export const ReceiverBadge = (props: { readonly status: ReceiverStatus; readonly t: TracesTranslate }): JSX.Element => {
  const endpoint = receiverEndpoint(props.status)
  if (props.status.state === 'listening' && endpoint !== null)
    return (
      <Badge variant="success" data-testid="traces-receiver-state" data-state="listening" title={endpoint}>
        {props.t('receiverListening')} <span className="dshx:font-mono">{endpoint}</span>
      </Badge>
    )
  if (props.status.state === 'port-in-use')
    return (
      <Badge variant="warning" data-testid="traces-receiver-state" data-state="port-in-use">
        {props.t('receiverPortInUse')} {String(props.status.configuredPort)}
      </Badge>
    )
  if (props.status.state === 'failed')
    return (
      <Badge variant="destructive" data-testid="traces-receiver-state" data-state="failed">
        {props.t('receiverFailed')}
      </Badge>
    )
  if (props.status.mode === 'external')
    return (
      <Badge variant="info" data-testid="traces-receiver-state" data-state="external">
        {props.t('externalViewer')}
      </Badge>
    )
  return (
    <Badge variant="muted" data-testid="traces-receiver-state" data-state={props.status.state}>
      {props.status.state === 'starting' ? props.t('receiverStarting') : props.t('receiverDisabled')}
    </Badge>
  )
}

export const ReceiverMessage = (props: { readonly status: ReceiverStatus; readonly t: TracesTranslate }): JSX.Element | null => {
  const external = props.status.mode !== 'plugin' ? props.status.externalViewerUrl : null
  if (props.status.message === null && external === null && props.status.forward.lastError === null) return null
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2">
      {props.status.message === null ? null : (
        <Alert variant={props.status.state === 'listening' ? 'default' : 'destructive'}>
          <AlertDescription>{props.status.message}</AlertDescription>
        </Alert>
      )}
      {props.status.forward.url === null || props.status.forward.lastError === null ? null : (
        <Alert>
          <AlertTitle>
            {props.t('forwardingTo')} {props.status.forward.url}
          </AlertTitle>
          <AlertDescription>{props.status.forward.lastError}</AlertDescription>
        </Alert>
      )}
      {external === null ? null : (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
          <span>
            {props.t('externalViewer')}: <span className="dshx:font-mono">{external}</span>
          </span>
          <Button asChild variant="outline" size="sm">
            <a href={external} target="_blank" rel="noreferrer">
              <ExternalLinkIcon /> {props.t('openExternalViewer')}
            </a>
          </Button>
        </div>
      )}
    </div>
  )
}

export const EmptyStoreGuide = (props: { readonly status: ReceiverStatus; readonly t: TracesTranslate }): JSX.Element => {
  const endpoint = receiverEndpoint(props.status) ?? `http://${props.status.address}:${String(props.status.configuredPort)}`
  if (props.status.mode === 'external')
    return (
      <Alert data-testid="traces-empty-guide">
        <AlertTitle>{props.t('externalModeTitle')}</AlertTitle>
        <AlertDescription>{props.t('externalModeBody')}</AlertDescription>
      </Alert>
    )
  return (
    <Alert data-testid="traces-empty-guide">
      <AlertTitle>{props.t('emptyTitle')}</AlertTitle>
      <AlertDescription>
        <ol className="dshx:flex dshx:list-decimal dshx:flex-col dshx:gap-1 dshx:pl-4">
          <li>{props.t('emptyStep1')}</li>
          <li>
            <code className="dshx:font-mono dshx:text-xs">OTEL_EXPORTER_OTLP_ENDPOINT={endpoint}</code>
          </li>
          <li>{props.t('emptyStep2')}</li>
          <li>{props.t('emptyStep3')}</li>
        </ol>
      </AlertDescription>
    </Alert>
  )
}
