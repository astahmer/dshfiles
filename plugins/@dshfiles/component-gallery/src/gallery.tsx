import * as React from 'react'
import { Page } from '@dshfiles/plugin-ui/components/page'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { SearchInput } from '@dshfiles/plugin-ui/components/ui/search-input'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { RotateCcwIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { usePrefersReducedMotion } from '@dshfiles/plugin-ui/motion/react'
import { GalleryModel } from './gallery-model.js'
import type { GalleryCategory, GalleryDemo } from './demos/types.js'

export interface GalleryPageProps {
  readonly categories: readonly GalleryCategory[]
}

/** The component gallery: one tab per category, a card per component, a filter over titles and imports. */
export function GalleryPage({ categories }: GalleryPageProps) {
  const [tab, setTab] = React.useState(categories[0]?.id ?? '')
  const [query, setQuery] = React.useState('')
  const [replayAll, setReplayAll] = React.useState(0)
  const reduced = usePrefersReducedMotion()
  const category = categories.find(candidate => candidate.id === tab) ?? categories[0]
  const demos = category === undefined ? [] : GalleryModel.filter(category.demos, query)

  return (
    <TooltipProvider>
      <Page
        className="dshx-root"
        scroll
        heading="Components"
        description="Every shared plugin-ui component, live. Import paths are on each card."
        count={GalleryModel.total(categories)}
        meta={reduced ? <Badge variant="secondary">Reduced motion on</Badge> : undefined}
        actions={[{ id: 'replay', label: 'Replay all', icon: <RotateCcwIcon />, onSelect: () => setReplayAll(n => n + 1) }]}
        tabs={{
          label: 'Component categories',
          value: category?.id ?? '',
          onValueChange: setTab,
          items: categories.map(item => ({ value: item.id, label: item.label, count: item.demos.length })),
        }}
      >
        <div className="dshx:flex dshx:flex-col dshx:gap-4">
          <div className="dshx:flex dshx:items-center dshx:gap-3 dshx:@max-pane-narrow:flex-col dshx:@max-pane-narrow:items-stretch">
            <p className="dshx:min-w-0 dshx:flex-1 dshx:text-sm dshx:text-muted-foreground">{category?.description}</p>
            <SearchInput
              className="dshx:w-64 dshx:max-w-full"
              aria-label="Filter components"
              placeholder="Filter components"
              value={query}
              onChange={event => setQuery(event.currentTarget.value)}
            />
          </div>
          {demos.length === 0 ? (
            <p className="dshx:py-10 dshx:text-center dshx:text-sm dshx:text-muted-foreground">
              No component matches “{query}”. Clear the filter to see all of them.
            </p>
          ) : (
            <div
              className="dshx:grid dshx:grid-cols-2 dshx:gap-4 dshx:@max-pane-compact:grid-cols-1"
              role="list"
              aria-label={`${category?.label ?? ''} components`}
            >
              {demos.map(demo => (
                <DemoCard key={`${demo.id}:${replayAll}`} demo={demo} />
              ))}
            </div>
          )}
        </div>
      </Page>
    </TooltipProvider>
  )
}

function DemoCard({ demo }: { readonly demo: GalleryDemo }) {
  const [run, setRun] = React.useState(0)
  const headingId = `gallery-${demo.id}`
  return (
    <section
      role="listitem"
      aria-labelledby={headingId}
      className={cn(
        'dshx:flex dshx:min-w-0 dshx:flex-col dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card',
        demo.wide && 'dshx:col-span-2 dshx:@max-pane-compact:col-span-1',
      )}
    >
      <header className="dshx:flex dshx:items-start dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4 dshx:py-3">
        <div className="dshx:min-w-0 dshx:flex-1">
          <h2 id={headingId} className="dshx:truncate dshx:text-sm dshx:font-semibold">
            {demo.title}
          </h2>
          <p className="dshx:text-xs dshx:text-muted-foreground">{demo.description}</p>
          <code className="dshx:mt-1 dshx:block dshx:truncate dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground">{demo.source}</code>
        </div>
        {demo.static ? null : (
          <Button variant="ghost" size="xs" aria-label={`Replay ${demo.title}`} onClick={() => setRun(n => n + 1)}>
            <RotateCcwIcon /> Replay
          </Button>
        )}
      </header>
      <div className="dshx:flex dshx:min-h-40 dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:justify-center dshx:overflow-hidden dshx:p-5">
        <DemoBoundary key={run} heading={demo.title}>
          <div className="dshx:w-full dshx:min-w-0">{demo.render()}</div>
        </DemoBoundary>
      </div>
    </section>
  )
}

interface DemoBoundaryState {
  readonly error: string | null
}

class DemoBoundary extends React.Component<{ readonly heading: string; readonly children: React.ReactNode }, DemoBoundaryState> {
  override state: DemoBoundaryState = { error: null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  override render() {
    if (this.state.error === null) return this.props.children
    return (
      <p role="alert" className="dshx:text-xs dshx:text-destructive">
        {this.props.heading} failed to render: {this.state.error}. Press Replay to retry, or check the browser console for the stack.
      </p>
    )
  }
}
