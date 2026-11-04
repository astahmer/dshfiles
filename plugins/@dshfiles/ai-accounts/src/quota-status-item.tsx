import { StatusItems, type StatusItemProps } from '@dshfiles/frame-layout/status-strip'
import type { PluginContext } from '@dshfiles/dshx/client'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ReactNode } from 'react'

/**
 * AI accounts in the status strip (plan `plans/ade-ux` §4.1 R5, §6 "Quota in the status strip; sidebar footer cards
 * removed"). The item is the same usage strip the sidebar footer used to seat, squeezed to the strip's one line on
 * desktop and left to wrap inside the phone chip list. frame-layout owns the strip; this file is the whole provider.
 */
const QuotaStatusFrame = (props: { readonly compact: boolean; readonly children: ReactNode }): JSX.Element => (
  <span
    className={cn(
      'dshx-root dshx:flex dshx:min-w-0 dshx:items-center',
      // One 24 px line: the meters keep their text, lose their 32 px button height, and never wrap the strip.
      !props.compact && 'dshx:[&>div]:flex-nowrap dshx:[&>div]:p-0 dshx:[&_button]:h-5 dshx:[&_button]:min-h-0 dshx:[&_button]:py-0',
    )}
    data-testid="status-item-quota"
  >
    {props.children}
  </span>
)

/** Add the one ai-accounts item; `View` renders the usage strip for the frame's current thread. */
const register = (plugin: Pick<PluginContext, 'add' | 'bind'>, View: (props: StatusItemProps) => JSX.Element): (() => void) => {
  const Item = (props: StatusItemProps): JSX.Element => (
    <QuotaStatusFrame compact={props.compact}>
      <View {...props} />
    </QuotaStatusFrame>
  )
  return plugin.add(StatusItems, { id: '@dshfiles/ai-accounts', side: 'global', order: 20, label: 'Quota', component: plugin.bind(Item) })
}

export class QuotaStatusItem {
  static readonly register = register
}
