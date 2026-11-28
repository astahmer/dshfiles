import { RouteModel, modelIdentity } from '@dshfiles/plugin-ui/components/model-mark'
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
  readonly label: string
  readonly removeLabel: (model: string) => string
  readonly onRemove: (route: FanOutChosenRoute) => void
}) => (
  <div aria-label={props.label} className="dshx:flex dshx:flex-wrap dshx:gap-1.5" data-fan-out-chosen role="group">
    {props.routes.map(route => {
      const name = modelIdentity(route.provider, route.model)?.name ?? route.model
      return (
        <span
          className="dshx:inline-flex dshx:h-8 dshx:max-w-full dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:rounded-full dshx:border dshx:border-border dshx:pr-0.5 dshx:pl-2.5 dshx:text-sm dshx:pointer-coarse:h-11"
          data-fan-out-chip
          key={`${route.provider}/${route.model}`}
        >
          <RouteModel className="dshx:min-w-0 dshx:text-foreground" model={route.model} provider={route.provider} seat size="md" />
          <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">{props.accountOf(route.provider)}</span>
          <button
            aria-label={props.removeLabel(name)}
            className="dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:text-muted-foreground dshx:hover:bg-muted dshx:hover:text-foreground dshx:pointer-coarse:size-11"
            onClick={() => props.onRemove(route)}
            type="button"
          >
            <XIcon aria-hidden="true" className="dshx:size-3.5" />
          </button>
        </span>
      )
    })}
  </div>
)

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
