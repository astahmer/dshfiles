import { useEffect, useRef, useState } from 'react'
import type { WorkbenchTranslate } from './locales.js'
import type { WorkbenchPanelDefinition, WorkbenchPanelProps } from './registry.js'

/** Mounts per panel id for this page, so a remount shows as a count above 1 even though React state is reset. */
const mountCounts = new Map<string, number>()

const useMountCount = (panelId: string): number => {
  const [mounts, setMounts] = useState(() => mountCounts.get(panelId) ?? 0)
  useEffect(() => {
    const next = (mountCounts.get(panelId) ?? 0) + 1
    mountCounts.set(panelId, next)
    setMounts(next)
  }, [panelId])
  return mounts
}

const useRenderCount = (): number => {
  const renders = useRef(0)
  renders.current += 1
  return renders.current
}

const Counters = (props: { readonly t: WorkbenchTranslate; readonly mounts: number; readonly renders: number }): JSX.Element => (
  <dl className="dshx:flex dshx:gap-4 dshx:text-xs dshx:text-muted-foreground">
    <div className="dshx:flex dshx:gap-1">
      <dt>{props.t('mountsLabel')}</dt>
      <dd data-testid="mounts">{props.mounts}</dd>
    </div>
    <div className="dshx:flex dshx:gap-1">
      <dt>{props.t('rendersLabel')}</dt>
      <dd data-testid="renders">{props.renders}</dd>
    </div>
  </dl>
)

const Scratchpad = (props: WorkbenchPanelProps & { readonly t: WorkbenchTranslate }): JSX.Element => {
  const mounts = useMountCount(props.panelId)
  const renders = useRenderCount()
  const [draft, setDraft] = useState('')
  return (
    <section className="dshx-root dshx:flex dshx:h-full dshx:flex-col dshx:gap-2 dshx:p-3">
      <Counters t={props.t} mounts={mounts} renders={renders} />
      <textarea
        aria-label={props.t('scratchpadTitle')}
        className="dshx:min-h-0 dshx:flex-1 dshx:resize-none dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:p-2 dshx:text-sm dshx:font-mono!"
        placeholder={props.t('scratchpadPlaceholder')}
        value={draft}
        onChange={event => setDraft(event.target.value)}
      />
    </section>
  )
}

const Ticker = (props: WorkbenchPanelProps & { readonly t: WorkbenchTranslate }): JSX.Element => {
  const mounts = useMountCount(props.panelId)
  const renders = useRenderCount()
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSeconds(current => current + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <section className="dshx-root dshx:flex dshx:h-full dshx:flex-col dshx:gap-2 dshx:p-3">
      <Counters t={props.t} mounts={mounts} renders={renders} />
      <p className="dshx:text-sm dshx:text-muted-foreground">{props.t('tickerHint')}</p>
      <output data-testid="seconds" className="dshx:text-3xl dshx:font-semibold dshx:tabular-nums">
        {seconds}
      </output>
    </section>
  )
}

export const demoPanels = (t: WorkbenchTranslate): readonly WorkbenchPanelDefinition[] => [
  { id: 'dshfiles-workbench.scratchpad', title: `Workbench: ${t('scratchpadTitle')}`, component: props => <Scratchpad {...props} t={t} /> },
  { id: 'dshfiles-workbench.ticker', title: `Workbench: ${t('tickerTitle')}`, component: props => <Ticker {...props} t={t} /> },
]
