import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { LoaderCircleIcon, WandSparklesIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'

import type { BacklogBackfillResult } from './api.js'

const summaryOf = (result: BacklogBackfillResult): string => {
  if (result.reason !== null) return result.reason
  if (result.completed === 0) return result.remaining === 0 ? 'Nothing left to backfill.' : `${String(result.remaining)} tasks are waiting to be triaged.`
  const failed = result.failed === 0 ? '' : `, ${String(result.failed)} failed`
  const left = result.remaining === 0 ? ' Nothing left to backfill.' : ` ${String(result.remaining)} still untriaged.`
  return `Triaged ${String(result.completed)}: ${String(result.applied)} applied, ${String(result.proposed)} waiting as suggestions, ${String(result.unchanged)} unchanged${failed}.${left}`
}

/**
 * Runs triage over the backlog that predates it: old captures were never looked at, and nothing re-runs them on its
 * own. One bounded batch at a time, with the outcome kept on screen so a repeated run is an informed choice.
 */
export const BackfillDialog = (props: {
  readonly open: boolean
  readonly progress: BacklogBackfillResult | null
  readonly error: string | null
  readonly onError: (message: string) => void
  readonly triageOff: boolean
  readonly run: (request: { readonly retriage: boolean }) => Promise<void>
  readonly close: () => void
}): JSX.Element => {
  const [retriage, setRetriage] = useState(false)
  const job = props.progress
  const error = props.error
  const submit = async (): Promise<void> => {
    props.onError('')
    try {
      await props.run({ retriage })
    } catch (caught) {
      props.onError(errorMessage(caught, 'The backfill could not be started.'))
    }
  }
  const busy = job !== null && (job.state === 'queued' || job.state === 'running')
  const result = job !== null && (job.state === 'completed' || job.state === 'failed') ? job : null

  return (
    <Dialog open={props.open} onOpenChange={open => (open ? undefined : props.close())}>
      <DialogContent className="dshx-root dshx:sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Backfill triage</DialogTitle>
          <DialogDescription>
            Runs Jev and the configured triage model on inbox/todo tasks only, up to 25 per run. It continues in the background, so you can close this dialog
            and check progress later. A confident answer applies; a hesitant one waits in the Inbox.
          </DialogDescription>
        </DialogHeader>
        <div className="dshx:flex dshx:flex-col dshx:gap-3">
          <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-[13px]">
            <input type="checkbox" checked={retriage} onChange={event => setRetriage(event.currentTarget.checked)} disabled={busy} />
            Also re-triage items triage already looked at
          </label>
          {props.triageOff ? (
            <p className="dshx:text-xs dshx:text-warning">Triage is off. Turn on Jev or pick a provider and model in Settings → Backlog before backfilling.</p>
          ) : null}
          {job !== null && busy ? (
            <div className="dshx:flex dshx:flex-col dshx:gap-1.5" role="status" aria-live="polite">
              <p className="dshx:text-xs dshx:text-muted-foreground">
                {job.completed}/{job.total} tasks checked · {job.applied} applied · {job.proposed} suggestions · {job.failed} failed
              </p>
              <progress className="dshx:w-full dshx:accent-primary" value={job.completed} max={Math.max(1, job.total)} aria-label="Backfill progress" />
            </div>
          ) : null}
          {result === null ? null : (
            <p className={result.configured ? 'dshx:text-xs dshx:text-muted-foreground' : 'dshx:text-xs dshx:text-warning'}>{summaryOf(result)}</p>
          )}
          {error === null ? null : <p className="dshx:text-xs dshx:text-destructive">{error}</p>}
          {props.error === null ? null : <p className="dshx:text-xs dshx:text-destructive">{props.error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.close}>
            {busy ? 'Close and keep running' : result === null ? 'Cancel' : 'Close'}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || props.triageOff}>
            {busy ? <LoaderCircleIcon aria-hidden className="dshx:size-3.5 dshx:animate-spin" /> : <WandSparklesIcon aria-hidden className="dshx:size-3.5" />}
            {busy ? 'Running…' : 'Run backfill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
