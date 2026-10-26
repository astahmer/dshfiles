import type {} from '@deepseek-ai/dsh-session-log-export/client'
import type { SessionLogDownloadEntry } from '@deepseek-ai/dsh-session-log-export/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context } from '@deepseek-ai/cordis'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { DownloadIcon } from '@dshfiles/plugin-ui/icons'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { JjIntegrationTranslate } from './locales.js'
import { useToast } from './toast.js'

/** The export plugin's browser controller, typed through the Cordis service it provides (its class is not re-exported). */
export type SessionLogDownloadService = Context['sessionLogDownload']

/**
 * The Session-log export plugin owns the controller; a profile without it leaves this undefined, and then the
 * header keeps the plugin's own cell and the thread menu simply has no export row.
 */
export interface SessionLogDownloadPort {
  current: SessionLogDownloadService | undefined
}

export const createSessionLogDownloadPort = (): SessionLogDownloadPort => ({ current: undefined })

const noSubscribe = (): (() => void) => () => undefined

const useDownloadEntry = (port: SessionLogDownloadPort, sessionId: string): SessionLogDownloadEntry | undefined => {
  const controller = port.current
  const subscribe = useCallback((listener: () => void) => (controller === undefined ? noSubscribe() : controller.store.subscribe(listener)), [controller])
  const read = useCallback(() => (controller === undefined ? undefined : controller.store.getSnapshot().bySession[sessionId]), [controller, sessionId])
  return useSyncExternalStore(subscribe, read, () => undefined)
}

/**
 * What the export plugin's own header cell becomes: its menu moved into the thread workspace menu, so the cell only
 * keeps the feedback the plugin otherwise draws in its modal.
 */
export const SessionLogDownloadFeedback = (props: {
  readonly sessionId: string
  readonly controller: SessionLogDownloadService
  readonly t: JjIntegrationTranslate
}): JSX.Element | null => {
  const entry = useDownloadEntry({ current: props.controller }, props.sessionId)
  const status = entry?.status
  const error = entry?.error ?? ''
  const seen = useRef<typeof status>(undefined)
  const { show, element } = useToast()
  useEffect(() => {
    const previous = seen.current
    seen.current = status
    if (status === undefined || status === previous || status === 'downloading') return
    show({
      text: status === 'error' ? props.t('sessionLogFailed', { message: error === '' ? props.t('loadFailed') : error }) : props.t('sessionLogStarted'),
      success: status === 'success',
    })
  }, [status, error, props, show])
  return element
}

/** The export row inside the thread workspace menu: same download, one trigger for the header. */
export const SessionLogDownloadRow = (props: {
  readonly sessionId: string
  readonly port: SessionLogDownloadPort
  readonly t: JjIntegrationTranslate
}): JSX.Element | null => {
  const controller = props.port.current
  const downloading = useDownloadEntry(props.port, props.sessionId)?.status === 'downloading'
  if (controller === undefined) return null
  const label = downloading ? props.t('preparingSessionLog') : props.t('downloadSessionLog')
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={props.t('downloadSessionLog')}
            className="dshx-root dshx:w-full dshx:justify-start"
            disabled={downloading}
            onClick={() => void controller.download(SessionId(props.sessionId))}
            size="sm"
            type="button"
            variant="ghost"
          >
            {downloading ? <Spinner /> : <DownloadIcon aria-hidden="true" className="dshx:size-3.5" />}
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
