import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import type { BtwKey } from './locales.js'

type Translate = (key: BtwKey, params?: Record<string, string | number>) => string

/** One question for the thread the dialog was opened on; it closes once the fork is under way and the side panel opens. */
export const SideQuestionDialog = (props: {
  readonly threadTitle: string
  readonly ask: (question: string) => Promise<void>
  readonly onClose: () => void
  readonly t: Translate
}): ReactNode => {
  const [question, setQuestion] = useState('')
  const asking = useMutation({ mutationFn: props.ask, onSuccess: props.onClose })
  const submit = (): void => {
    if (question.trim() === '' || asking.isPending) return
    asking.mutate(question.trim())
  }
  return (
    <Dialog open onOpenChange={open => (open || asking.isPending ? undefined : props.onClose())}>
      <DialogContent className="dshx-root dshx:grid-cols-[minmax(0,1fr)] dshx:sm:max-w-lg" data-testid="dshfiles-btw-dialog">
        <DialogHeader>
          <DialogTitle className="dshx:text-base">{props.t('askTitle')}</DialogTitle>
          <DialogDescription className="dshx:break-words">{props.t('askDescription', { thread: props.threadTitle })}</DialogDescription>
        </DialogHeader>
        <form
          className="dshx:flex dshx:flex-col dshx:gap-3"
          onSubmit={event => {
            event.preventDefault()
            submit()
          }}
        >
          <Textarea
            aria-label={props.t('askLabel')}
            autoFocus
            className="dshx:min-h-24"
            disabled={asking.isPending}
            placeholder={props.t('askPlaceholder')}
            value={question}
            onChange={event => setQuestion(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              submit()
            }}
          />
          {asking.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(asking.error, props.t('failed', { reason: 'unknown' }))}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" disabled={asking.isPending} onClick={props.onClose}>
              {props.t('cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={question.trim() === '' || asking.isPending}>
              {asking.isPending ? props.t('forking') : props.t('askSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
