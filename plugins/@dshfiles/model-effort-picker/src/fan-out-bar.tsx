import { useId } from 'react'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import type { ModelPickerTranslate } from './locales.js'

/**
 * Council picker round 1, N6: select mode's action bar, shown once a row is chosen: "2 of 6 selected · Clear · Fan out…".
 * Fan out needs two routes; with one, the bar says so instead of leaving a disabled button unexplained.
 */
export const FanOutBar = (props: {
  readonly count: number
  readonly limit: number
  readonly t: ModelPickerTranslate
  readonly onClear: () => void
  readonly onFanOut: () => void
}) => {
  const reasonId = useId()
  if (props.count === 0) return null
  return (
    <div
      className="dshx:flex dshx:shrink-0 dshx:flex-col dshx:gap-0.5 dshx:border-t dshx:border-border dshx:px-1 dshx:pt-1.5"
      data-model-picker-fan-out
      role="group"
      aria-label="Fan-out selection"
    >
      <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
        <span aria-live="polite" className="dshx:truncate dshx:text-xs dshx:font-medium">
          {props.t('selectedOf', { count: props.count, limit: props.limit })}
        </span>
        <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1">
          <Button className="dshx:pointer-coarse:h-11" onClick={props.onClear} size="sm" type="button" variant="ghost">
            {props.t('clear')}
          </Button>
          <Button
            aria-describedby={props.count < 2 ? reasonId : undefined}
            className="dshx:pointer-coarse:h-11"
            disabled={props.count < 2}
            onClick={props.onFanOut}
            size="sm"
            type="button"
          >
            {props.t('fanOut')}
          </Button>
        </span>
      </div>
      {props.count < 2 ? (
        <p className="dshx:text-2xs dshx:text-muted-foreground" id={reasonId}>
          {props.t('fanOutNeedsTwo')}
        </p>
      ) : null}
    </div>
  )
}
