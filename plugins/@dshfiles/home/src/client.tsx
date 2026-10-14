import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { createApiClient, defineClient, useSettings } from '@dshfiles/dshx/client'
import { jjIntegrationApi, type RepositoryView } from '@dshfiles/jj-integration/api'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArrowRightIcon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { PluginQueryProvider, useQuery } from '@dshfiles/plugin-ui/query'
import { useCallback, useSyncExternalStore } from 'react'
import { HOME_LOCALE_NAMESPACE, homeLocale, type HomeTranslate } from './locales.js'
import { NewThreadSettings } from './settings-section.js'
import { brandStyle, projectOf } from './home-model.js'
import { homeSettings, type HomeSettings } from './settings.js'
import './client.css'

const RECENT_THREADS = 3
const defaults: HomeSettings = homeSettings.schema({})

interface Stores {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
}

const useStores = <Value,>(stores: Stores, read: () => Value): Value => {
  const subscribe = useCallback(
    (listener: () => void) => {
      const offSessions = stores.sessions.list.subscribe(listener)
      const offWorkspaces = stores.workspaces.list.subscribe(listener)
      return () => {
        offSessions()
        offWorkspaces()
      }
    },
    [stores],
  )
  return useSyncExternalStore(subscribe, read)
}

const workspaceOfSession = (stores: Stores, sessionId: string | undefined): WorkspaceView | undefined => {
  if (sessionId === undefined) return undefined
  const items = stores.workspaces.list.getSnapshot().items
  const own = items.find(item => item.sessionIds.some(id => id === sessionId))
  return own === undefined ? undefined : projectOf(own, items)
}

const mainSessionId = (stores: Stores): string | undefined => {
  const sessions = stores.sessions.list.getSnapshot()
  return sessions.ids.find(id => (sessions.byId[id]?.retainedBy.mainView ?? 0) > 0)
}

const BrandMark = (props: HeroBrandMarkOwnerProps & { readonly stores: Stores; readonly t: HomeTranslate }) => {
  const settings = useSettings(homeSettings).value ?? defaults
  const project = useStores(props.stores, () => workspaceOfSession(props.stores, mainSessionId(props.stores))?.title)
  const headline = settings.headline.trim().replaceAll('{project}', project ?? props.t('noProject'))
  const size = props.size ?? 34
  return (
    <span className="dshx:inline-flex dshx:items-center dshx:gap-2.5">
      <style>{brandStyle(settings)}</style>
      {settings.mark === 'text' && settings.markText.trim() !== '' ? <span style={{ fontSize: size * 0.8, lineHeight: 1 }}>{settings.markText}</span> : null}
      {settings.mark === 'image' && /^(https:|data:image\/)/.test(settings.markImageUrl) ? (
        <img src={settings.markImageUrl} alt="" width={size} height={size} style={{ objectFit: 'contain' }} />
      ) : null}
      {headline === '' ? null : <span>{headline}</span>}
    </span>
  )
}

const HomeStrip = (props: {
  readonly sessionId: SessionSummary['id']
  readonly stores: Stores
  readonly t: HomeTranslate
  readonly openSession: (sessionId: SessionSummary['id']) => void
  readonly openThreadWorkspaces: () => void
  readonly repositories: () => Promise<{ readonly repositories: readonly RepositoryView[] }>
}) => {
  const settings = useSettings(homeSettings).value ?? defaults
  const blank = useStores(props.stores, () => props.stores.sessions.list.getSnapshot().byId[props.sessionId]?.blank === true)
  const project = useStores(props.stores, () => workspaceOfSession(props.stores, props.sessionId))
  const recentKey = useStores(props.stores, () => {
    if (project === undefined) return ''
    const { items, archivedSessionIds } = props.stores.workspaces.list.getSnapshot()
    const archived = new Set<string>(archivedSessionIds)
    const byId = props.stores.sessions.list.getSnapshot().byId
    return items
      .filter(item => projectOf(item, items).workspaceId === project.workspaceId)
      .flatMap(item => item.sessionIds)
      .filter(id => id !== props.sessionId && !archived.has(id) && byId[id] !== undefined && byId[id]?.blank !== true)
      .sort((left, right) => (byId[right]?.updatedAt ?? 0) - (byId[left]?.updatedAt ?? 0))
      .slice(0, RECENT_THREADS)
      .join(',')
  })
  const unlanded = useQuery({
    queryKey: ['home', 'unlanded', project?.path ?? ''],
    enabled: blank && settings.showUnlandedWork && project !== undefined,
    // Reading every thread workspace is the costliest jj call on this screen; each New thread remounts it, and a
    // fresh read per mount competed with creating the thread's own workspace.
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      runHostRequest({ signal, timeoutMs: 30_000, request: () => props.repositories() }).then(
        result =>
          result.repositories.find(repository => repository.repoRoot === project?.path)?.threads.filter(thread => thread.unlanded.length > 0).length ?? 0,
      ),
  })
  if (!blank) return null
  const recentIds = new Set(settings.showRecentThreads && recentKey !== '' ? recentKey.split(',') : [])
  const sessions = props.stores.sessions.list.getSnapshot()
  const recent = sessions.ids
    .filter(id => recentIds.has(id))
    .sort((left, right) => (sessions.byId[right]?.updatedAt ?? 0) - (sessions.byId[left]?.updatedAt ?? 0))
  const toLand = unlanded.data ?? 0
  if (recent.length === 0 && toLand === 0) return null
  return (
    <div className="dshx-root dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:pb-2 dshx:text-xs dshx:text-muted-foreground" style={{ order: 1 }}>
      {recent.length > 0 ? <span>{props.t('resume')}</span> : null}
      {recent.map(id => (
        <Button key={id} size="sm" variant="ghost" className="dshx:h-7 dshx:max-w-56 dshx:px-2 dshx:text-xs" onClick={() => props.openSession(id)}>
          <span className="dshx:truncate">{sessions.byId[id]?.displayTitle}</span>
        </Button>
      ))}
      {toLand > 0 ? (
        <Button
          size="sm"
          variant="link"
          className="dshx:h-7 dshx:gap-1 dshx:px-1 dshx:text-xs"
          title={props.t('openThreadWorkspaces')}
          onClick={props.openThreadWorkspaces}
        >
          {props.t(toLand === 1 ? 'unlandedOne' : 'unlandedOther', { count: toLand })}
          <ArrowRightIcon aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}

export default defineClient({
  name: '@dshfiles/home',
  locales: [homeLocale],
  inject: ['slots', 'layout', 'sessions', 'workspaces', 'uiWorkspace'],
  setup(ctx, decorate) {
    const t = ctx.locale.bind(HOME_LOCALE_NAMESPACE)
    const stores: Stores = { sessions: ctx.sessions, workspaces: ctx.workspaces }
    const threads = createApiClient(ctx, jjIntegrationApi)
    ctx.slots.inject('conversation.hero.brand.mark', () =>
      ctx.slots.register(
        { name: 'conversation.hero.brand.mark', priority: -1000 },
        decorate((props: HeroBrandMarkOwnerProps) => <BrandMark {...props} stores={stores} t={t} />),
      ),
    )
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register({ name: 'settings.section', id: 'dshfiles-new-thread', order: 21, label: () => 'New thread' }, decorate(NewThreadSettings)),
    )
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        { name: 'conversation.input.dock', id: 'dshfiles-home-strip', order: 20, inject: sessionId => ({ sessionId }) },
        decorate((props: { readonly sessionId: SessionSummary['id'] }) => (
          <PluginQueryProvider>
            <HomeStrip
              sessionId={props.sessionId}
              stores={stores}
              t={t}
              openSession={sessionId => ctx.uiWorkspace.openSession(sessionId)}
              // SAFETY: jj-integration registers this main panel id.
              openThreadWorkspaces={() => ctx.layout.selectPanel('jj-integration' as MainPanelId)}
              repositories={() => threads.repositories({})}
            />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
