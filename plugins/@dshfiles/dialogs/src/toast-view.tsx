import { useSubscribable, type ToastTone } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { CheckIcon, CircleAlertIcon, InfoIcon, TriangleAlertIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useToastBottom } from './toast-placement.js'
import type { ToastEntry, ToastStack } from './toast-stack.js'

/** The tone is a small icon, never a coloured edge; only a failure spends colour (DESIGN.md "Colors"). */
const toneIcon = {
  info: InfoIcon,
  success: CheckIcon,
  warning: TriangleAlertIcon,
  danger: CircleAlertIcon,
} satisfies Record<ToastTone, typeof InfoIcon>

const Toast = (props: { readonly entry: ToastEntry; readonly onDismiss: () => void }): JSX.Element => {
  const { input } = props.entry
  const tone = input.tone ?? 'info'
  const Icon = toneIcon[tone]
  return (
    <li
      role={tone === 'danger' ? 'alert' : 'status'}
      data-tone={tone}
      className="dshx:pointer-events-auto dshx:flex dshx:w-80 dshx:max-w-full dshx:items-start dshx:gap-2.5 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-popover dshx:p-3 dshx:text-popover-foreground dshx:shadow-s2"
    >
      <Icon
        aria-hidden
        data-toast-icon=""
        className={cn('dshx:mt-0.5 dshx:size-4 dshx:shrink-0', tone === 'danger' ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')}
      />
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
        <p className="dshx:text-sm dshx:font-medium">{input.title}</p>
        {input.description !== undefined && <p className="dshx:text-xs dshx:text-muted-foreground">{input.description}</p>}
        {input.action !== undefined && (
          <Button
            size="sm"
            variant="outline"
            className="dshx:mt-1 dshx:self-start"
            onClick={() => {
              input.action?.run()
              props.onDismiss()
            }}
          >
            {input.action.label}
          </Button>
        )}
      </div>
      <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={props.onDismiss}>
        <XIcon />
      </Button>
    </li>
  )
}

export const ToastView = (props: { readonly stack: Pick<ToastStack, 'toasts' | 'dismiss'> }): JSX.Element | null => {
  const toasts = useSubscribable(props.stack.toasts)
  // Bottom right, lifted above a composer it would cover: the model picker and send button stay reachable.
  const bottom = useToastBottom(toasts.length > 0)
  if (toasts.length === 0) return null
  return (
    <ol
      aria-label="Notifications"
      className="dshx-root dshx:pointer-events-none dshx:fixed dshx:right-4 dshx:z-[1100] dshx:flex dshx:max-w-[calc(100%-2rem)] dshx:flex-col dshx:gap-2"
      style={{ bottom }}
    >
      {toasts.map(entry => (
        <Toast key={entry.id} entry={entry} onDismiss={() => props.stack.dismiss(entry.id)} />
      ))}
    </ol>
  )
}
