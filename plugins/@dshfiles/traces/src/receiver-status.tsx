import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ExternalLinkIcon } from '@dshfiles/plugin-ui/icons'
import type { TracesLocaleKey, TracesTranslate } from './locales.js'
import type { DiagnosisCode, ReceiverStatus } from './types.js'

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

type GuideCopy = {
  readonly title: TracesLocaleKey
  readonly body: TracesLocaleKey
  readonly restartHint: boolean
  readonly variant: 'default' | 'destructive'
}

const GUIDE_COPY = {
  waiting: { title: 'diagnosisWaitingTitle', body: 'diagnosisWaitingBody', restartHint: false, variant: 'default' },
  receiving: { title: 'diagnosisReceivingTitle', body: 'diagnosisWaitingBody', restartHint: false, variant: 'default' },
  starting: { title: 'receiverStarting', body: 'diagnosisWaitingBody', restartHint: false, variant: 'default' },
  'exporting-elsewhere': { title: 'diagnosisElsewhereTitle', body: 'diagnosisElsewhereBody', restartHint: true, variant: 'destructive' },
  'no-exporter': { title: 'diagnosisNoExporterTitle', body: 'diagnosisNoExporterBody', restartHint: true, variant: 'destructive' },
  'port-in-use': { title: 'diagnosisPortInUseTitle', body: 'diagnosisPortInUseBody', restartHint: false, variant: 'destructive' },
  failed: { title: 'diagnosisFailedTitle', body: 'diagnosisFailedBody', restartHint: false, variant: 'destructive' },
  'external-mode': { title: 'externalModeTitle', body: 'externalModeBody', restartHint: false, variant: 'default' },
} as const satisfies Record<DiagnosisCode, GuideCopy>

/** This Host's own telemetry cannot reach the receiver: worth saying even while older telemetry is stored. */
export const exportBlocked = (status: ReceiverStatus): boolean => status.diagnosis?.code === 'exporting-elsewhere' || status.diagnosis?.code === 'no-exporter'

/**
 * Says why nothing arrives: the Host's diagnosis (exporter configured elsewhere or off, port held, external mode),
 * with the endpoint other processes should use. A Host older than the diagnosis gets the generic setup steps.
 */
export const EmptyStoreGuide = (props: { readonly status: ReceiverStatus; readonly t: TracesTranslate; readonly compact?: boolean }): JSX.Element => {
  const endpoint = receiverEndpoint(props.status) ?? `http://${props.status.address}:${String(props.status.configuredPort)}`
  const diagnosis = props.status.diagnosis
  if (diagnosis === undefined)
    return (
      <Alert data-testid="traces-empty-guide">
        <AlertTitle>{props.t(props.status.mode === 'external' ? 'externalModeTitle' : 'emptyTitle')}</AlertTitle>
        <AlertDescription>
          {props.status.mode === 'external' ? props.t('externalModeBody') : `${props.t('emptyStep1')} OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}`}
        </AlertDescription>
      </Alert>
    )
  const copy = GUIDE_COPY[diagnosis.code]
  const elsewhere = props.status.exporters?.traces.source === 'environment' ? props.status.exporters.traces.url : null
  if (diagnosis.code === 'port-in-use')
    return (
      <Alert variant="destructive" data-testid="traces-empty-guide" data-diagnosis={diagnosis.code}>
        <AlertTitle>{props.t(copy.title)}</AlertTitle>
        <AlertDescription>
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
            <p>{props.t(copy.body)}</p>
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-3">
              <Button
                size="sm"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('dshfiles:open-settings', {
                      detail: { setting: { entryId: 'dshfiles-traces', fieldPath: ['port'] } },
                      cancelable: true,
                    }),
                  )
                }}
                data-testid="traces-change-port"
              >
                {props.t('changePort')}
              </Button>
              <details className="dshx:text-xs dshx:text-muted-foreground">
                <summary className="dshx:cursor-pointer">{props.t('receiverDiagnostics')}</summary>
                <div className="dshx:mt-1 dshx:break-all">
                  <p>
                    {props.t('receiverPortLabel')}: <code className="dshx:font-mono">{String(props.status.configuredPort)}</code>
                  </p>
                  <p>{diagnosis.message}</p>
                </div>
              </details>
            </div>
          </div>
        </AlertDescription>
      </Alert>
    )
  return (
    <Alert variant={copy.variant} data-testid="traces-empty-guide" data-diagnosis={diagnosis.code}>
      <AlertTitle>{props.t(copy.title)}</AlertTitle>
      <AlertDescription>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1.5">
          <p>{diagnosis.code === 'failed' ? diagnosis.message : props.t(copy.body)}</p>
          {diagnosis.code === 'exporting-elsewhere' && elsewhere !== null ? (
            <code className="dshx:font-mono dshx:text-xs dshx:break-all">OTEL_EXPORTER_OTLP_ENDPOINT → {elsewhere}</code>
          ) : null}
          {copy.restartHint ? <p>{props.t('restartHint')}</p> : null}
          {props.compact === true || diagnosis.code === 'external-mode' ? null : (
            <>
              <p>{props.t('otherProcessesHint')}</p>
              <code className="dshx:font-mono dshx:text-xs dshx:break-all">OTEL_EXPORTER_OTLP_ENDPOINT={endpoint}</code>
            </>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
