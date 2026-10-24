import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { SirenIcon } from '@dshfiles/plugin-ui/icons'
import type { TracesAlertsTranslate } from './alerts-locale.js'

/** The attention marker on the Alerts tab: the number of firing rules, nothing while none fire. */
export const FiringAlertsCount = (props: { readonly firing: number | null }): JSX.Element | null =>
  props.firing === null || props.firing === 0 ? null : (
    <Badge variant="destructive" className="dshx:ml-1 dshx:h-4 dshx:min-w-4 dshx:px-1 dshx:text-[10px]" data-testid="traces-alerts-firing-count">
      {props.firing}
    </Badge>
  )

/** Above every other tab while a rule fires, so a firing alert is never one tab away from being missed. */
export const FiringAlertsBanner = (props: {
  readonly firing: number | null
  readonly onShow: () => void
  readonly t: TracesAlertsTranslate
}): JSX.Element | null =>
  props.firing === null || props.firing === 0 ? null : (
    <Alert variant="destructive" data-testid="traces-alerts-banner" className="dshx:flex dshx:items-center dshx:gap-2 dshx:py-2">
      <SirenIcon className="dshx:size-4" />
      <AlertDescription className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:justify-between dshx:gap-2">
        <span className="dshx:min-w-0 dshx:truncate">
          {props.firing} {props.t('firingSuffix')}
        </span>
        <Button variant="outline" size="sm" onClick={props.onShow}>
          {props.t('showFiring')}
        </Button>
      </AlertDescription>
    </Alert>
  )
