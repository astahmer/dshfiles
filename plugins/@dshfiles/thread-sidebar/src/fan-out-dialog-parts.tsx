import type { ReactNode } from 'react'
import { AccountDot, type AccountAccent } from '@dshfiles/ai-accounts/account-color'
import { ModelMark, RouteModel, modelFamily, modelIdentity } from '@dshfiles/plugin-ui/components/model-mark'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { XIcon } from '@dshfiles/plugin-ui/icons'

export interface FanOutChosenRoute {
  readonly provider: string
  readonly model: string
}

/**
 * Council picker round 1, N7: the models a fan-out goes to, first in the dialog, as removable chips with their marks and
 * the account each runs on. The catalog below still adds and removes them; the chips say what Send will do at a glance.
 */
export const FanOutChosen = (props: {
  readonly routes: readonly FanOutChosenRoute[]
  readonly accountOf: (provider: string) => string
  /** Round 5 U2: the account's dot before its tag, as in the model picker. */
  readonly accentOf?: (provider: string) => AccountAccent | undefined
  readonly label: string
  readonly removeLabel: (model: string) => string
  readonly onRemove: (route: FanOutChosenRoute) => void
  /** Round 4 T3: what ends the chip row (the Edit models ghost chip). */
  readonly trailing?: ReactNode
  readonly className?: string
}) => (
  <div aria-label={props.label} className={cn('dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5', props.className)} data-fan-out-chosen role="group">
    {props.routes.map(route => {
      const name = modelIdentity(route.provider, route.model)?.name ?? route.model
      return (
        <span
          className="dshx:inline-flex dshx:h-8 dshx:max-w-full dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:border-border dshx:pr-0.5 dshx:pl-2.5 dshx:text-sm dshx:dark:border-field-border dshx:pointer-coarse:h-11"
          data-fan-out-chip
          key={`${route.provider}/${route.model}`}
        >
          <RouteModel className="dshx:min-w-0 dshx:text-foreground" model={route.model} provider={route.provider} seat size="md" />
          <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
            {(() => {
              const accent = props.accentOf?.(route.provider)
              return accent === undefined ? null : <AccountDot accent={accent} className="dshx:size-1.5" />
            })()}
            {props.accountOf(route.provider)}
          </span>
          <button
            aria-label={props.removeLabel(name)}
            className="dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:hover:bg-muted dshx:hover:text-foreground dshx:pointer-coarse:size-11"
            onClick={() => props.onRemove(route)}
            type="button"
          >
            <XIcon aria-hidden="true" className="dshx:size-3.5" />
          </button>
        </span>
      )
    })}
    {props.trailing}
  </div>
)

/**
 * Round 4 T3: the chosen models in one row while the keyboard is up: their marks overlapped, "6 models", and Edit, so
 * the prompt keeps its lines above the actions.
 */
export const FanOutSummary = (props: {
  readonly routes: readonly FanOutChosenRoute[]
  readonly countLabel: string
  readonly editLabel: string
  readonly onEdit: () => void
  readonly className?: string
}) => (
  <div className={cn('dshx:min-h-11 dshx:items-center dshx:gap-2', props.className)} data-fan-out-summary>
    {/* Round 5 U2: one 20 px mark per distinct family, at most three, then the count. */}
    <span aria-hidden="true" className="dshx:flex dshx:items-center">
      {fanOutFamilies(props.routes).map((route, index) => (
        <span
          className={cn(
            'dshx:flex dshx:size-5 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-background dshx:ring-1 dshx:ring-border',
            index > 0 && 'dshx:-ml-1.5',
          )}
          key={route.model}
        >
          <ModelMark modelId={route.model} />
        </span>
      ))}
    </span>
    <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-medium">{props.countLabel}</span>
    <Button className="dshx:pointer-coarse:h-11" onClick={props.onEdit} size="sm" type="button" variant="ghost">
      {props.editLabel}
    </Button>
  </div>
)

/** The first route of each distinct model family, at most three (round 5 U2). */
export const fanOutFamilies = (routes: readonly FanOutChosenRoute[]): readonly FanOutChosenRoute[] => {
  const seen = new Set<string>()
  return routes
    .filter(route => {
      const family = modelFamily(route.model) ?? route.model
      if (seen.has(family)) return false
      seen.add(family)
      return true
    })
    .slice(0, 3)
}

/** N7: what Send says and, when it cannot run, why: two models and a prompt are needed. */
export const fanOutSendState = (input: {
  readonly count: number
  readonly prompt: string
  readonly pending: boolean
}): { readonly count: number; readonly disabled: boolean; readonly reason: 'needs-two' | 'needs-prompt' | null } => {
  const reason = input.count < 2 ? 'needs-two' : input.prompt.trim() === '' ? 'needs-prompt' : null
  return { count: input.count, disabled: input.pending || reason !== null, reason }
}

/** The account's short tag, as the status bar and the model picker show it ("CC2"). */
export const accountTagOf = (name: string): string =>
  name
    .split(/\s+/u)
    .filter(Boolean)
    .map(part => (/^\d+$/u.test(part) ? part : part[0]))
    .join('')
    .slice(0, 3)
    .toUpperCase() || name

/** One naming (council picker N1): the kit's display name for a route, the catalog name only when the kit has none. */
export const fanOutModelName = (provider: string, model: string, catalogName: string): string => modelIdentity(provider, model)?.name ?? catalogName
