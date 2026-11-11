import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import type { ReactNode } from 'react'
import type { OnScreenProject } from './on-screen-project.js'
import { TOUCH } from './touch.js'
import type { TryItInput, TryItOutput } from './try-it-model.js'

/** What Try it demonstrates: one catalogued feature or one pack, named for the dialog title. */
export type TryItTarget = { readonly feature: string; readonly title: string } | { readonly pack: string; readonly title: string }

export interface TryItDialogProps {
  readonly target: TryItTarget | null
  /** The project on screen the demo starts in; `null` starts it in the Host default directory. */
  readonly project: OnScreenProject | null
  /** Starts the demo thread and sends its first message; called only from the confirm button. */
  readonly startTryIt: (input: TryItInput) => Promise<TryItOutput>
  readonly openThread: (sessionId: TryItOutput['sessionId']) => void
  readonly onClose: () => void
}

export const TRY_IT_COST =
  'This starts a new thread and sends it a demo prompt right away. The agent there runs on your default model and spends tokens on your current AI account. It shows the feature with read-only tools and asks before changing anything.'

const inputOf = (target: TryItTarget, project: OnScreenProject | null): TryItInput => ({
  ...('feature' in target ? { feature: target.feature } : { pack: target.pack }),
  ...(project === null ? undefined : { project: project.projectId }),
  confirm: true,
})

const ConfirmBody = (props: TryItDialogProps & { readonly target: TryItTarget }): ReactNode => {
  const openThread = props.openThread
  const onClose = props.onClose
  const start = useMutation({
    mutationFn: () => props.startTryIt(inputOf(props.target, props.project)),
    onSuccess: started => {
      if (started.prompt === 'refused') return
      openThread(started.sessionId)
      onClose()
    },
  })
  const refused = start.data?.prompt === 'refused' ? start.data : null
  return (
    <>
      <DialogHeader>
        <DialogTitle>Try it: {props.target.title}</DialogTitle>
        <DialogDescription data-try-it-cost="">{TRY_IT_COST}</DialogDescription>
        <p className="dshx:text-sm dshx:text-muted-foreground" data-try-it-project="">
          {props.project === null ? 'Starts in the Host default directory.' : `Starts in ${props.project.title}.`}
        </p>
      </DialogHeader>
      {start.isError ? (
        <Alert role="alert" variant="destructive">
          <AlertTitle>No demo started</AlertTitle>
          <AlertDescription>
            {errorMessage(start.error, 'The Host did not answer. Check that the onboarding plugin is enabled, then try again.')}
          </AlertDescription>
        </Alert>
      ) : null}
      {refused === null ? null : (
        <Alert role="status" variant="warning">
          <AlertTitle>The thread started without its demo prompt</AlertTitle>
          <AlertDescription>
            {refused.promptError ?? 'The thread did not accept its first message.'} Open the thread to send it again, or archive it.
          </AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button className={TOUCH} disabled={start.isPending} onClick={props.onClose} variant="outline">
          {refused === null ? 'Cancel' : 'Close'}
        </Button>
        {refused === null ? (
          <Button className={TOUCH} disabled={start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? <Spinner className="dshx:size-4" /> : null}
            {start.isError ? 'Try again' : 'Start demo'}
          </Button>
        ) : (
          <Button
            className={TOUCH}
            onClick={() => {
              openThread(refused.sessionId)
              onClose()
            }}
          >
            Open thread
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

/** Names the cost and starts nothing until Start demo; Cancel, Escape and the overlay close it with nothing sent. */
export const TryItDialog = (props: TryItDialogProps): ReactNode => {
  const target = props.target
  return (
    <Dialog
      onOpenChange={open => {
        if (!open) props.onClose()
      }}
      open={target !== null}
    >
      <DialogContent className="dshx-root" data-try-it-dialog="" showCloseButton={false}>
        {target === null ? null : <ConfirmBody {...props} key={'feature' in target ? target.feature : `pack:${target.pack}`} target={target} />}
      </DialogContent>
    </Dialog>
  )
}
