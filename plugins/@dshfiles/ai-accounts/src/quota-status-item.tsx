import { StatusItems, type StatusItemProps } from '@dshfiles/frame-layout/status-strip'
import type { PluginContext } from '@dshfiles/dshx/client'

/**
 * AI accounts in the status strip (plan `docs/ade-ux` §4.1 R5; polish pass b:r4et). The item is one quiet line per
 * account (`QuotaStatusLine`): it says what is left in words, so the phone pill reads "Jarvis 51% left" without the
 * frame adding its "Quota" label. frame-layout owns the strip; this file is the whole provider.
 */
const register = (input: {
  readonly plugin: Pick<PluginContext, 'add' | 'bind'>
  readonly View: (props: StatusItemProps) => JSX.Element
  readonly open: () => void
}): (() => void) => {
  const { plugin, View } = input
  const Item = (props: StatusItemProps): JSX.Element => (
    <span className="dshx-root dshx:flex dshx:min-w-0 dshx:items-center" data-testid="status-item-quota">
      <View {...props} />
    </span>
  )
  return plugin.add(StatusItems, {
    id: '@dshfiles/ai-accounts',
    side: 'global',
    order: 20,
    label: 'Quota',
    summaryLabel: false,
    component: plugin.bind(Item),
    open: input.open,
    controls: true,
  })
}

export class QuotaStatusItem {
  static readonly register = register
}
