import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ShellTranslate } from './native/locales.js'
import type { SettingsOriginCounts, SettingsOriginFilter } from './settings-groups.js'
import { SegmentedFilter } from './segmented-filter.js'

/**
 * Which categories show: those stock DSH ships, those plugins add, or all of them, each with its count (upstream #290).
 * It heads the category list it narrows: the side column's, the page's own, or the phone's category list.
 */
export const OriginFilterBar = (props: {
  readonly value: SettingsOriginFilter
  readonly counts: SettingsOriginCounts
  readonly t: ShellTranslate
  readonly onChange: (next: SettingsOriginFilter) => void
  readonly className?: string
}): JSX.Element => (
  <div className={cn('dshx:flex dshx:shrink-0', props.className)} data-settings-origin-filter="">
    <SegmentedFilter
      dense
      fill
      label={props.t('origin.filterLabel')}
      onChange={props.onChange}
      optionAttribute="data-origin-option"
      options={[
        { id: 'all', label: props.t('origin.all'), count: props.counts.all },
        { id: 'dsh', label: props.t('origin.dsh'), count: props.counts.dsh },
        { id: 'plugin', label: props.t('origin.plugins'), count: props.counts.plugin },
      ]}
      value={props.value}
    />
  </div>
)
