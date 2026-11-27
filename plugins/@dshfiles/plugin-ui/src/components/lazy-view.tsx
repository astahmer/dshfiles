import * as React from 'react'
import { LoadError } from './load-error.js'
import { Spinner } from './ui/spinner.js'

/** A chunk usually arrives within this; showing a loading state sooner only flashes. */
export const LAZY_VIEW_QUIET_MS = 150

type LazyState<P> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly component: React.ComponentType<P> }
  | { readonly status: 'failed'; readonly error: unknown }

export interface LazyView<P> extends React.FC<P> {
  /** Start loading before the view mounts (a hover, an idle moment); resolves once it can render at once. */
  readonly preload: () => Promise<void>
}

/** Renders nothing for the quiet window, then one muted loading line. */
function QuietLoading(props: { readonly text: string }): React.ReactNode {
  const [visible, setVisible] = React.useState(false)
  React.useEffect(() => {
    const timer = setTimeout(() => setVisible(true), LAZY_VIEW_QUIET_MS)
    return () => clearTimeout(timer)
  }, [])
  if (!visible) return null
  return (
    <div
      role="status"
      data-slot="lazy-view-loading"
      className="dshx:flex dshx:items-center dshx:justify-center dshx:gap-2 dshx:px-4 dshx:py-8 dshx:text-sm dshx:text-muted-foreground"
    >
      <Spinner aria-hidden role="presentation" aria-label={undefined} />
      {props.text}
    </div>
  )
}

/**
 * A view whose code loads on first use: pass `() => import('./view.js').then(module => module.View)` so the plugin's
 * build emits it as a lazy chunk and page boot does not parse it. The first mount shows nothing for
 * {@link LAZY_VIEW_QUIET_MS}, then a quiet loading line; a chunk that fails to load says so with Retry. Once loaded,
 * every later mount renders the view at once.
 */
export function lazyView<P extends object>(
  load: () => Promise<React.ComponentType<P>>,
  options: {
    /** What the view is, as a page names it: "Backlog", "Usage history"; the loading line and the load error use it. */
    readonly label: string
    /** The loading line, for a view inside a sentence ("Loading the diff…"); defaults to "Loading <label>…". */
    readonly loading?: string
  },
): LazyView<P> {
  let state: LazyState<P> = { status: 'idle' }
  let pending: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const set = (next: LazyState<P>): void => {
    state = next
    for (const listener of listeners) listener()
  }
  const start = (): Promise<void> => {
    if (state.status === 'loaded') return Promise.resolve()
    if (pending !== undefined) return pending
    set({ status: 'loading' })
    pending = load().then(
      component => set({ status: 'loaded', component }),
      (error: unknown) => set({ status: 'failed', error }),
    )
    void pending.finally(() => {
      pending = undefined
    })
    return pending
  }
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const read = (): LazyState<P> => state
  const View = (props: P): React.ReactNode => {
    const current = React.useSyncExternalStore(subscribe, read, read)
    React.useEffect(() => {
      if (current.status === 'idle') void start()
    }, [current.status])
    if (current.status === 'loaded') return <current.component {...props} />
    if (current.status === 'failed') return <LoadError subject={options.label} error={current.error} onRetry={() => void start()} />
    return <QuietLoading text={options.loading ?? `Loading ${options.label}…`} />
  }
  View.displayName = `LazyView(${options.label})`
  return Object.assign(View, { preload: start })
}
