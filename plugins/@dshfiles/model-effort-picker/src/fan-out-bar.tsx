import { useId } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ModelPickerTranslate } from './locales.js'
import { ModelPickerModel } from './model-picker-model.js'
import { BrandMark } from './picker-atoms.js'

type CatalogGroup = ModelDirectoryState['groups'][number]

/**
 * Select mode's summary (council picker round 1, N6; round 3, R12). On desktop it is the tray that replaces the details
 * pane: the chosen models as chips with their marks, "2 selected · up to 6", why Fan out waits, and Fan out at the foot.
 * On a phone it is a bar under the list. Both show from the moment the mode is on and reserve the reason's line, so
 * choosing a model never moves anything; the count is announced politely.
 */
export const FanOutSelection = (props: {
  readonly variant: 'bar' | 'tray'
  readonly routes: readonly ModelSelection[]
  readonly groups: readonly CatalogGroup[]
  readonly accountTagOf: (provider: string) => string
  readonly limit: number
  readonly t: ModelPickerTranslate
  readonly onRemove: (route: ModelSelection) => void
  readonly onClear: () => void
  readonly onFanOut: () => void
  readonly className?: string
}) => {
  const reasonId = useId()
  const count = props.routes.length
  const reason = count < 2 ? props.t('fanOutNeedsTwo') : ''
  const summary = (
    <span aria-live="polite" className="dshx:truncate dshx:text-xs dshx:font-medium" data-model-fan-out-count>
      {props.t('selectedUpTo', { count, limit: props.limit })}
    </span>
  )
  const actions = (
    <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1">
      <Button className="dshx:pointer-coarse:h-11" disabled={count === 0} onClick={props.onClear} size="sm" type="button" variant="ghost">
        {props.t('clear')}
      </Button>
      <Button
        aria-describedby={count < 2 ? reasonId : undefined}
        className="dshx:pointer-coarse:h-11"
        disabled={count < 2}
        onClick={props.onFanOut}
        size="sm"
        type="button"
      >
        {props.t('fanOut')}
      </Button>
    </span>
  )
  // The reason keeps its line whether or not it has words, so the actions never jump.
  const reasonLine = (
    <p className="dshx:min-h-4 dshx:text-2xs dshx:leading-4 dshx:text-muted-foreground" data-model-fan-out-reason id={reasonId}>
      {reason}
    </p>
  )

  if (props.variant === 'bar')
    return (
      <div
        aria-label="Fan-out selection"
        className={cn('dshx:shrink-0 dshx:flex-col dshx:gap-0.5 dshx:border-t dshx:border-border dshx:px-1 dshx:pt-1.5', props.className)}
        data-model-picker-fan-out="bar"
        role="group"
      >
        <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
          {summary}
          {actions}
        </div>
        {reasonLine}
      </div>
    )

  return (
    <section
      aria-label="Fan-out selection"
      className={cn('dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-2', props.className)}
      data-model-picker-fan-out="tray"
    >
      <header className="dshx:flex dshx:min-h-8 dshx:items-center dshx:pr-7 dshx:pointer-coarse:pr-12">{summary}</header>
      <ul className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-1 dshx:overflow-y-auto" data-model-fan-out-chips>
        {props.routes.map(route => {
          const group = props.groups.find(candidate => candidate.id === route.provider)
          const model = group?.models.find(candidate => candidate.id === route.model)
          const name = group === undefined || model === undefined ? route.model : ModelPickerModel.displayName({ group, model })
          return (
            <li
              className="dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:pr-0.5 dshx:pl-2 dshx:text-sm"
              data-model-fan-out-chip
              key={`${route.provider}/${route.model}`}
            >
              <BrandMark brand={model === undefined ? undefined : ModelPickerModel.brandFor({ model })} className="dshx:size-4" name={name} />
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{name}</span>
              <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">{props.accountTagOf(route.provider)}</span>
              <Button
                aria-label={props.t('remove', { model: name })}
                className="dshx:size-7 dshx:shrink-0 dshx:text-muted-foreground dshx:pointer-coarse:size-11"
                onClick={() => props.onRemove(route)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <XIcon aria-hidden="true" className="dshx:size-3.5" />
              </Button>
            </li>
          )
        })}
        {count === 0 ? <li className="dshx:text-xs dshx:text-muted-foreground">{props.t('chooseInList')}</li> : null}
      </ul>
      <footer className="dshx:flex dshx:shrink-0 dshx:flex-col dshx:gap-1 dshx:border-t dshx:border-border dshx:pt-2">
        {reasonLine}
        <div className="dshx:flex dshx:justify-end">{actions}</div>
      </footer>
    </section>
  )
}
