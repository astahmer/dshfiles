import { Button } from '@dshfiles/plugin-ui/components/ui/button'

/**
 * Council picker round 1, N4: the list's empty states, each with its way forward. A search with no match offers to clear
 * it; no model at all says why and opens AI accounts, where an account is added or shown.
 */
export const ListEmptyState = (props: {
  readonly kind: 'loading' | 'no-match' | 'no-models'
  readonly query: string
  readonly onClearSearch: () => void
  readonly onOpenAccounts?: (() => void) | undefined
}) => (
  <div className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-2 dshx:px-3 dshx:py-8 dshx:text-center" data-model-picker-empty={props.kind}>
    {props.kind === 'loading' ? (
      <p className="dshx:text-sm dshx:text-muted-foreground">Loading models…</p>
    ) : props.kind === 'no-match' ? (
      <>
        <p className="dshx:text-sm">No models match “{props.query.trim()}”</p>
        <Button className="dshx:pointer-coarse:h-11" onClick={props.onClearSearch} size="sm" type="button" variant="outline">
          Clear search
        </Button>
      </>
    ) : (
      <>
        <p className="dshx:text-sm dshx:font-medium">No models available</p>
        <p className="dshx:max-w-64 dshx:text-xs dshx:text-muted-foreground">Add an account, or show a hidden one, to choose a model here.</p>
        {props.onOpenAccounts === undefined ? null : (
          <Button className="dshx:pointer-coarse:h-11" onClick={props.onOpenAccounts} size="sm" type="button" variant="outline">
            Open AI accounts
          </Button>
        )}
      </>
    )}
  </div>
)
