import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { LoaderCircleIcon, WandSparklesIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'

import type { BacklogBackfillResult } from './api.js'

const summaryOf = (result: BacklogBackfillResult): string => {
  if (result.considered === 0) return result.remaining === 0 ? 'Nothing left to backfill.' : `${String(result.remaining)} items are waiting to be triaged.`
  const failed = result.failed === 0 ? '' : `, ${String(result.failed)} failed`
  const left = result.remaining === 0 ? ' Nothing left to backfill.' : ` ${String(result.remaining)} still untriaged.`
  return `Triaged ${String(result.considered)}: ${String(result.applied)} applied, ${String(result.proposed)} waiting as suggestions, ${String(result.unchanged)} unchanged${failed}.${left}`
}

/**
 * Runs triage over the backlog that predates it: old captures were never looked at, and nothing re-runs them on its
 * own. One bounded batch at a time, with the outcome kept on screen so a repeated run is an informed choice.
 */
export const BackfillDialog = (props: {
  readonly triageOff: boolean
  readonly run: (request: { readonly retriage: boolean }) => Promise<BacklogBackfillResult>
  readonly close: () => void
}): JSX.Element => {
  const [retriage, setRetriage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BacklogBackfillResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setResult(await props.run({ retriage }))
    } catch (caught) {
      setError(errorMessage(caught, 'The backfill failed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => (open ? undefined : props.close())}>
      <DialogContent className="dshx-root dshx:sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Backfill triage</DialogTitle>
          <DialogDescription>
            Runs Jev and the configured triage model on the oldest open items that no triage has looked at yet, up to 25 per run. A confident answer applies; a
            hesitant one waits in the Inbox.
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
          {result === null ? null : (
            <p className={result.configured ? 'dshx:text-xs dshx:text-muted-foreground' : 'dshx:text-xs dshx:text-warning'}>
              {result.configured ? summaryOf(result) : result.reason}
            </p>
          )}
          {error === null ? null : <p className="dshx:text-xs dshx:text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.close} disabled={busy}>
            {result === null ? 'Cancel' : 'Close'}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || props.triageOff}>
            {busy ? <LoaderCircleIcon aria-hidden className="dshx:size-3.5 dshx:animate-spin" /> : <WandSparklesIcon aria-hidden className="dshx:size-3.5" />}
            Run backfill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
