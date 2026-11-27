import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { LayersIcon, PuzzleIcon } from '@dshfiles/plugin-ui/icons'
import type { ShellTranslate } from './native/locales.js'
import type { SettingsEntryOrigin } from './origin.js'

/** "DSH default" or "Plugin", with the owning package next to a plugin's badge when it is known. */
export const OriginBadge = (props: {
  readonly origin: SettingsEntryOrigin
  readonly bundleName?: string | undefined
  readonly showBundle?: boolean
  readonly t: ShellTranslate
}): JSX.Element => (
  <span className="dshx:inline-flex dshx:flex-wrap dshx:items-center dshx:gap-1.5">
    {props.origin === 'dsh' ? (
      <Badge data-origin-badge="dsh" variant="secondary">
        <LayersIcon aria-hidden="true" />
        {props.t('origin.dshBadge')}
      </Badge>
    ) : (
      <Badge data-origin-badge="plugin" variant="info">
        <PuzzleIcon aria-hidden="true" />
        {props.t('origin.pluginBadge')}
      </Badge>
    )}
    {props.showBundle !== false && props.origin === 'plugin' && props.bundleName !== undefined && (
      <code className="dshx:rounded dshx:bg-muted dshx:px-1.5 dshx:py-0.5 dshx:font-mono dshx:text-2xs dshx:text-muted-foreground">{props.bundleName}</code>
    )}
  </span>
)
