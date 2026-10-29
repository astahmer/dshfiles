import { useSubscribable, type ToastTone } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ToastEntry, ToastStack } from './toast-stack.js'

const toneClass: Record<ToastTone, string> = {
  info: 'dshx:border-l-border',
  success: 'dshx:border-l-success',
  warning: 'dshx:border-l-warning',
  danger: 'dshx:border-l-destructive',
}

const Toast = (props: { readonly entry: ToastEntry; readonly onDismiss: () => void }): JSX.Element => {
  const { input } = props.entry
  const tone = input.tone ?? 'info'
  return (
    <li
      role={tone === 'danger' ? 'alert' : 'status'}
      data-tone={tone}
      className={cn(
        'dshx:pointer-events-auto dshx:flex dshx:w-80 dshx:max-w-full dshx:items-start dshx:gap-3 dshx:rounded-md dshx:border dshx:border-l-4 dshx:bg-popover dshx:p-3 dshx:text-popover-foreground dshx:shadow-lg',
        toneClass[tone],
      )}
    >
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
  if (toasts.length === 0) return null
  return (
    <ol
      aria-label="Notifications"
      className="dshx-root dshx:pointer-events-none dshx:fixed dshx:right-4 dshx:bottom-4 dshx:z-[1100] dshx:flex dshx:max-w-[calc(100%-2rem)] dshx:flex-col dshx:gap-2"
    >
      {toasts.map(entry => (
        <Toast key={entry.id} entry={entry} onDismiss={() => props.stack.dismiss(entry.id)} />
      ))}
    </ol>
  )
}
