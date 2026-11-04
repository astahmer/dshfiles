import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { useApi, useRegistry } from '@dshfiles/dshx/client'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useMemo, useSyncExternalStore } from 'react'
import { backgroundJobsApi } from './api.js'
import type { BackgroundJobsTranslate } from './locales.js'
import { BackgroundJobsPanel } from './panel.js'
import { PROCESSES_JOBS_TAB, ProcessViews, type ProcessView } from './process-views.js'

/** The selected tab: module state shared by the page and the `ProcessesNavigation` contract. */
let selectedTab = PROCESSES_JOBS_TAB
const listeners = new Set<() => void>()
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const select = (tab: string): void => {
  if (selectedTab === tab) return
  selectedTab = tab
  for (const listener of listeners) listener()
}

const ordered = (views: readonly ProcessView[]): readonly ProcessView[] => {
  const seen = new Set<string>([PROCESSES_JOBS_TAB])
  const unique: { readonly view: ProcessView; readonly index: number }[] = []
  for (const [index, view] of views.entries()) {
    if (seen.has(view.id)) continue
    seen.add(view.id)
    unique.push({ view, index })
  }
  return unique.sort((left, right) => (left.view.order ?? 0) - (right.view.order ?? 0) || left.index - right.index).map(entry => entry.view)
}

/** Threads that run a background job now: the dev-servers tab asks only those. */
const RUNNING_LIMIT = 200

const ProcessesPage = (props: { readonly sessions: ISessions; readonly uiWorkspace: UiWorkspace; readonly t: BackgroundJobsTranslate }): JSX.Element => {
  const t = props.t
  const views = ordered(useRegistry(ProcessViews))
  const tab = useSyncExternalStore(
    subscribe,
    () => selectedTab,
    () => selectedTab,
  )
  const active = views.find(view => view.id === tab)
  const api = useApi(backgroundJobsApi)
  const sessionLabel = EntityLabels.useSessionLabel(props.sessions)
  const running = useQuery({
    queryKey: ['dshfiles-background-jobs', 'running-owners'],
    queryFn: ({ signal }) => api.board({ scope: 'running', limit: RUNNING_LIMIT }, { signal }),
    enabled: active !== undefined,
    refetchInterval: 10_000,
  })
  const threadIds = useMemo(() => [...new Set((running.data?.rows ?? []).flatMap(row => (row.owner === null ? [] : [row.owner])))], [running.data])
  const openThread = (sessionId: string): void => {
    const target = Object.values(props.sessions.list.getSnapshot().byId).find(summary => summary?.id === sessionId)?.id
    if (target !== undefined) props.uiWorkspace.openSession(target)
  }
  const Active = active?.Page
  return (
    <BackgroundJobsPanel
      sessions={props.sessions}
      uiWorkspace={props.uiWorkspace}
      t={t}
      heading={t('processesTitle')}
      description={t('processesSubtitle')}
      {...(views.length === 0
        ? {}
        : {
            tabs: {
              label: t('processesViews'),
              value: active === undefined ? PROCESSES_JOBS_TAB : active.id,
              onValueChange: select,
              items: [{ value: PROCESSES_JOBS_TAB, label: t('tabJobs') }, ...views.map(view => ({ value: view.id, label: view.label }))],
            },
          })}
      {...(Active === undefined ? {} : { otherTab: <Active threadIds={threadIds} threadLabel={sessionLabel} openThread={openThread} /> })}
    />
  )
}

/** Views the Jobs facet shows for one thread: those that can filter to it, in tab order. */
const threadViews = (views: readonly ProcessView[]): readonly ProcessView[] => ordered(views).filter(view => view.Thread !== undefined)

export class Processes {
  static readonly Page = ProcessesPage
  static readonly select = select
  static readonly selected = (): string => selectedTab
  /** Registered tabs after Jobs: one per id (the first wins), by order, then registration order. */
  static readonly ordered = ordered
  static readonly threadViews = threadViews
}
