import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ReactNode } from 'react'

interface InlinePanelProps {
  /** The accessible name of the panel, read by a screen reader before its heading. */
  readonly label: string
  readonly tone?: 'default' | 'destructive'
  readonly onCancel: () => void
  readonly children: ReactNode
  readonly className?: string
}

/** The one shape every revision-row action uses instead of a modal: a bordered panel inside the row it acts on. */
export const InlinePanel = (props: InlinePanelProps): JSX.Element => (
  <section
    aria-label={props.label}
    className={cn(
      'dshx-root dshx:mt-2 dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:p-3',
      props.tone === 'destructive' ? 'dshx:border-destructive/40 dshx:bg-destructive/5' : 'dshx:border-primary/40 dshx:bg-primary/5',
      props.className,
    )}
    onKeyDown={event => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      props.onCancel()
    }}
    role="group"
  >
    {props.children}
  </section>
)

interface InlinePanelActionsProps {
  readonly confirmLabel: string
  readonly confirmVariant?: 'default' | 'destructive'
  readonly busy?: boolean
  readonly confirmDisabled?: boolean
  /** A form's submit button replaces the button, so Enter in its field previews instead of doing nothing. */
  readonly type?: 'button' | 'submit'
  /** A panel with its own first field keeps focus there; the confirm button only takes it when nothing else should. */
  readonly autoFocusConfirm?: boolean
  readonly onCancel: () => void
  readonly onConfirm?: () => void
}

/** The Cancel/confirm pair every row panel ends with, so one panel cannot drift from the next. */
export const InlinePanelActions = (props: InlinePanelActionsProps): JSX.Element => (
  <div className="dshx:flex dshx:justify-end dshx:gap-2">
    <Button onClick={props.onCancel} size="sm" type="button" variant="outline">
      Cancel
    </Button>
    <Button
      autoFocus={props.type !== 'submit' && props.autoFocusConfirm !== false}
      disabled={props.busy === true || props.confirmDisabled === true}
      onClick={props.onConfirm}
      size="sm"
      type={props.type ?? 'button'}
      variant={props.confirmVariant ?? 'default'}
    >
      {props.busy === true && <Spinner className="dshx:size-3" />}
      {props.confirmLabel}
    </Button>
  </div>
)
