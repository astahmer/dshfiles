import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClientPlugin, useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { mcpServersApi, type ManagerSnapshot, type RegistryEntry, type ServerDraft, type ServerView } from './api.js'
import { filterProviders } from './catalog.js'
import { MCP_LOCALE_NAMESPACE, mcpServersLocale } from './locales.js'
import { runAfterConfirmation } from './confirmed-action.js'
import { createQuickPanelContribution, SessionQuickPanels, type QuickPanelState } from './quick-panel.js'
import styles from './manager.module.css'

const PANEL_ID = 'mcp-servers'
const icon = (size = 18): JSX.Element => (
  <svg
    aria-hidden
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 7h8M8 12h8M8 17h8" />
    <circle cx="5" cy="7" r="1" />
    <circle cx="5" cy="12" r="1" />
    <circle cx="5" cy="17" r="1" />
  </svg>
)

const slug = (value: string): string => {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'mcp-server'
  )
}

const blankDraft = (name = '', endpoint = ''): ServerDraft => {
  return {
    id: '',
    name,
    serverName: slug(name),
    enabled: true,
    transport: 'streamable-http',
    url: endpoint,
    headerRefs: {},
    startCommand: null,
  }
}

const referenceMap = (text: string): Record<string, string> => {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Enter a JSON object of names to credential references.')
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') throw new Error('Every credential reference must be a string.')
    result[key] = value
  }
  return result
}

const referencesFor = (server: ServerView, prefix: string): Record<string, string> => {
  return Object.fromEntries(
    server.credentialReferences.filter(item => item.target.startsWith(prefix)).map(item => [item.target.slice(prefix.length), item.reference]),
  )
}

export default defineClientPlugin({
  id: 'dshfiles-mcp-servers',
  name: '@dshfiles/mcp-servers',
  uses: ['ui'],
  inject: ['commandUi'],
  locales: [mcpServersLocale],
  setup(api) {
    const ctx = api.raw.ctx
    const translate = ctx.locale.bind(MCP_LOCALE_NAMESPACE) as T
    const RootQuickPanel = ({ panel }: { panel: QuickPanelState }): JSX.Element => <McpQuickPanel t={translate} panel={panel} />
    const RootPanel = (): JSX.Element => <ManagerPage t={translate} />
    const panels = new SessionQuickPanels()

    api.ui.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 2, label: () => translate('title'), locale: MCP_LOCALE_NAMESPACE }, () => icon())
    api.ui.register({ name: 'main', key: PANEL_ID, locale: MCP_LOCALE_NAMESPACE }, RootPanel)
    api.ui.register(
      {
        name: 'conversation.input.overlay',
        id: 'mcp-servers-quick-panel',
        order: 3,
        locale: MCP_LOCALE_NAMESPACE,
        inject: sessionId => ({ panel: panels.forSession(sessionId) }),
      },
      RootQuickPanel,
    )

    ctx.effect(() => ctx.commandUi.register(createQuickPanelContribution(panels, translate)), 'MCP quick panel command')
  },
})

type T = (key: keyof typeof EN_KEYS) => string
const EN_KEYS = {
  title: true,
  subtitle: true,
  refresh: true,
  add: true,
  manage: true,
  browse: true,
  servers: true,
  empty: true,
  name: true,
  serverName: true,
  transport: true,
  http: true,
  stdio: true,
  endpoint: true,
  command: true,
  cwd: true,
  envRefs: true,
  headerRefs: true,
  save: true,
  cancel: true,
  edit: true,
  remove: true,
  enable: true,
  disable: true,
  enabled: true,
  disabled: true,
  ready: true,
  needsCredentials: true,
  references: true,
  connectionUnknown: true,
  registeredTools: true,
  clientLoaded: true,
  clientStarting: true,
  clientStopped: true,
  clientFailed: true,
  manuallyDisconnected: true,
  connect: true,
  disconnect: true,
  configuredServers: true,
  custom: true,
  providers: true,
  registry: true,
  search: true,
  searchRegistry: true,
  docs: true,
  configure: true,
  registryDisclaimer: true,
  noRegistryResults: true,
  error: true,
  confirmRemove: true,
  serverNameHint: true,
  referencesHint: true,
  addFromCatalog: true,
  close: true,
  quickPanelHint: true,
  quickPanelSearch: true,
  quickPanelEmpty: true,
  quickPanelNoResults: true,
  localStart: true,
  localEnvRefs: true,
  localProcess: true,
  localStarting: true,
  localRunning: true,
  localExited: true,
  localStopping: true,
  localStopped: true,
  localStopUnconfirmed: true,
} as const

const localProcessText = (server: ServerView, t: T): string | undefined => {
  if (server.localProcess === 'not-configured') return undefined
  const state =
    server.localProcess === 'starting'
      ? t('localStarting')
      : server.localProcess === 'running'
        ? t('localRunning')
        : server.localProcess === 'exited'
          ? t('localExited')
          : server.localProcess === 'stopping'
            ? t('localStopping')
            : server.localProcess === 'stop-unconfirmed'
              ? t('localStopUnconfirmed')
              : t('localStopped')
  return `${t('localProcess')}: ${state}`
}

const McpQuickPanel = ({ t, panel }: { t: T; panel: QuickPanelState }): JSX.Element | null => {
  const api = useApi(mcpServersApi)
  const open = useSyncExternalStore(panel.subscribe, panel.getSnapshot)
  const [manage, setManage] = useState(false)
  const [snapshot, setSnapshot] = useState<ManagerSnapshot | null>(null)
  const [quickSearch, setQuickSearch] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.refresh())
    } catch {
      setNotice(t('error'))
    }
  }, [api, t])
  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const toggle = async (server: ServerView) => {
    try {
      setSnapshot(await api.setEnabled({ id: server.id, enabled: !server.enabled }))
    } catch {
      setNotice(t('error'))
    }
  }

  const setConnection = async (server: ServerView) => {
    const connected = server.clientLifecycle !== 'loaded' && server.clientLifecycle !== 'starting'
    try {
      setSnapshot(await api.setConnection({ id: server.id, connected }))
    } catch {
      setNotice(t('error'))
    }
  }

  const lifecycleText = (server: ServerView): string => {
    if (server.clientLifecycle === 'loaded') return t('clientLoaded')
    if (server.clientLifecycle === 'starting') return t('clientStarting')
    if (server.clientLifecycle === 'start-failed') return t('clientFailed')
    if (server.clientLifecycle === 'manually-disconnected') return t('manuallyDisconnected')
    return t('clientStopped')
  }

  const quickServers = (snapshot?.servers ?? []).filter(server => {
    const needle = quickSearch.trim().toLocaleLowerCase()
    return needle === '' || `${server.name} ${server.serverName}`.toLocaleLowerCase().includes(needle)
  })

  return (
    <>
      {open ? (
        <div className={styles.quickPanel} role="dialog" aria-label={t('title')}>
          <div className={styles.quickHeader}>
            <strong>{t('title')}</strong>
            <button type="button" className={styles.iconButton} onClick={() => panel.close()} aria-label={t('close')}>
              ×
            </button>
          </div>
          <input
            className={styles.input}
            value={quickSearch}
            onChange={event => setQuickSearch(event.currentTarget.value)}
            placeholder={t('quickPanelSearch')}
            aria-label={t('quickPanelSearch')}
          />
          {snapshot?.servers.length ? (
            quickServers.length ? (
              quickServers.map(server => (
                <div className={styles.quickRow} key={server.id}>
                  <div className={styles.quickInfo}>
                    <strong>{server.name}</strong>
                    <span>
                      {server.enabled ? t('enabled') : t('disabled')} · {lifecycleText(server)} · {server.registeredToolCount} {t('registeredTools')}
                    </span>
                    {localProcessText(server, t) ? <span>{localProcessText(server, t)}</span> : null}
                    <span>{t('connectionUnknown')}</span>
                  </div>
                  <div className={styles.quickActions}>
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => void setConnection(server)}
                      disabled={
                        !server.enabled || (server.configuration !== 'ready' && server.clientLifecycle !== 'loaded' && server.clientLifecycle !== 'starting')
                      }
                    >
                      {server.clientLifecycle === 'loaded' || server.clientLifecycle === 'starting' ? t('disconnect') : t('connect')}
                    </button>
                    <button type="button" className={styles.textButton} onClick={() => void toggle(server)}>
                      {server.enabled ? t('disable') : t('enable')}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className={styles.emptySmall}>{t('quickPanelNoResults')}</p>
            )
          ) : (
            <p className={styles.emptySmall}>{t('empty')}</p>
          )}
          {notice ? <p className={styles.notice}>{notice}</p> : null}
          <div className={styles.quickFooter}>
            <button type="button" className={styles.textButton} onClick={() => void refresh()} aria-label={t('refresh')}>
              ↻
            </button>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                setManage(true)
                panel.close()
              }}
            >
              {t('manage')}
            </button>
            <button
              type="button"
              className={styles.primarySmall}
              onClick={() => {
                setManage(true)
                panel.close()
              }}
            >
              ＋ {t('add')}
            </button>
          </div>
        </div>
      ) : null}
      {manage ? <ManagerDialog t={t} onClose={() => setManage(false)} /> : null}
    </>
  )
}

const ManagerPage = ({ t }: { t: T }): JSX.Element => {
  return <ManagerView t={t} />
}

const ManagerDialog = ({ t, onClose }: { t: T; onClose: () => void }): JSX.Element => {
  return (
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={t('title')}>
        <div className={styles.dialogHeader}>
          <strong>{t('title')}</strong>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t('close')}>
            ×
          </button>
        </div>
        <ManagerView t={t} />
      </section>
    </div>
  )
}

const ManagerView = ({ t }: { t: T }): JSX.Element => {
  const api = useApi(mcpServersApi)
  const [snapshot, setSnapshot] = useState<ManagerSnapshot | null>(null)
  const [draft, setDraft] = useState<ServerDraft | null>(null)
  const [envText, setEnvText] = useState('{}')
  const [headerText, setHeaderText] = useState('{}')
  const [startEnvText, setStartEnvText] = useState('{}')
  const [query, setQuery] = useState('')
  const [registry, setRegistry] = useState<RegistryEntry[]>([])
  const [registryQuery, setRegistryQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.refresh())
    } catch {
      setNotice(t('error'))
    }
  }, [api, t])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const filteredProviders = useMemo(() => {
    return filterProviders(snapshot?.providers ?? [], query)
  }, [snapshot, query])

  const startEdit = (server: ServerView) => {
    if (server.transport === 'streamable-http') {
      setDraft({
        id: server.id,
        name: server.name,
        serverName: server.serverName,
        enabled: server.enabled,
        transport: 'streamable-http',
        url: server.url,
        headerRefs: {},
        startCommand: server.startCommand === undefined ? null : { ...server.startCommand, envRefs: {} },
      })
      setHeaderText(JSON.stringify(referencesFor(server, 'header:'), null, 2))
      setStartEnvText(JSON.stringify(referencesFor(server, 'local-environment:'), null, 2))
      setEnvText('{}')
    } else {
      setDraft({
        id: server.id,
        name: server.name,
        serverName: server.serverName,
        enabled: server.enabled,
        transport: 'stdio',
        commandLine: server.commandLine,
        cwd: server.cwd,
        envRefs: {},
      })
      setEnvText(JSON.stringify(referencesFor(server, 'environment:'), null, 2))
      setHeaderText('{}')
      setStartEnvText('{}')
    }
    setNotice('')
  }

  const save = async () => {
    if (draft === null) return
    setBusy(true)
    setNotice('')
    try {
      const server =
        draft.transport === 'stdio'
          ? { ...draft, envRefs: referenceMap(envText) }
          : {
              ...draft,
              headerRefs: referenceMap(headerText),
              startCommand:
                draft.startCommand === null || draft.startCommand === undefined ? null : { ...draft.startCommand, envRefs: referenceMap(startEnvText) },
            }
      setSnapshot(await api.save({ server } as { server: ServerDraft }))
      setDraft(null)
    } catch {
      setNotice(t('error'))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (server: ServerView) => {
    setBusy(true)
    setNotice('')
    try {
      setSnapshot(await api.setEnabled({ id: server.id, enabled: !server.enabled }))
    } catch {
      setNotice(t('error'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (server: ServerView) => {
    setBusy(true)
    setNotice('')
    try {
      const next = await runAfterConfirmation(
        () => globalThis.confirm(t('confirmRemove')),
        () => api.remove({ id: server.id }),
      )
      if (next !== undefined) setSnapshot(next)
    } catch {
      setNotice(t('error'))
    } finally {
      setBusy(false)
    }
  }

  const search = async () => {
    const searchQuery = query.trim()
    if (searchQuery.length === 0) return
    setSearching(true)
    setNotice('')
    setRegistry([])
    setRegistryQuery('')
    try {
      setRegistry(await api.searchRegistry({ query: searchQuery }))
      setRegistryQuery(searchQuery)
    } catch {
      setRegistry([])
      setNotice(t('error'))
    } finally {
      setSearching(false)
    }
  }

  const beginProvider = (name: string, endpoint = '') => {
    setDraft(blankDraft(name, endpoint))
    setHeaderText('{}')
    setEnvText('{}')
    setStartEnvText('{}')
    setNotice('')
  }

  const setConnection = async (server: ServerView) => {
    const connected = server.clientLifecycle !== 'loaded' && server.clientLifecycle !== 'starting'
    setBusy(true)
    setNotice('')
    try {
      setSnapshot(await api.setConnection({ id: server.id, connected }))
    } catch {
      setNotice(t('error'))
    } finally {
      setBusy(false)
    }
  }

  const lifecycleText = (server: ServerView): string => {
    if (server.clientLifecycle === 'loaded') return t('clientLoaded')
    if (server.clientLifecycle === 'starting') return t('clientStarting')
    if (server.clientLifecycle === 'start-failed') return t('clientFailed')
    if (server.clientLifecycle === 'manually-disconnected') return t('manuallyDisconnected')
    return t('clientStopped')
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => void refresh()}>
            {t('refresh')}
          </button>
          <button type="button" className={styles.primary} onClick={() => beginProvider(t('custom'))}>
            ＋ {t('add')}
          </button>
        </div>
      </header>
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      {draft ? (
        <ServerEditor
          t={t}
          draft={draft}
          setDraft={setDraft}
          envText={envText}
          setEnvText={setEnvText}
          headerText={headerText}
          setHeaderText={setHeaderText}
          startEnvText={startEnvText}
          setStartEnvText={setStartEnvText}
          busy={busy}
          onSave={() => void save()}
          onCancel={() => setDraft(null)}
        />
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>{t('configuredServers')}</h2>
          <span>{snapshot?.servers.length ?? '…'}</span>
        </div>
        {snapshot?.servers.length ? (
          <div className={styles.serverList}>
            {snapshot.servers.map(server => (
              <article className={styles.serverCard} key={server.id}>
                <div className={styles.serverMain}>
                  <div className={styles.serverGlyph}>{icon(18)}</div>
                  <div className={styles.serverCopy}>
                    <strong>{server.name}</strong>
                    <span>{server.transport === 'stdio' ? server.commandLine : server.url}</span>
                    <span>
                      {server.enabled ? t('enabled') : t('disabled')} · {server.configuration === 'ready' ? t('ready') : t('needsCredentials')}
                    </span>
                    <span>
                      {lifecycleText(server)} · {server.registeredToolCount} {t('registeredTools')}
                    </span>
                    {localProcessText(server, t) ? <span>{localProcessText(server, t)}</span> : null}
                    <span>{t('connectionUnknown')}</span>
                    {server.credentialReferences.length ? (
                      <span>
                        {t('references')}:{' '}
                        {server.credentialReferences.map(ref => `${ref.target} → ${ref.reference} (${ref.configured ? 'set' : 'missing'})`).join(', ')}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className={styles.serverActions}>
                  <button type="button" className={styles.textButton} onClick={() => startEdit(server)}>
                    {t('edit')}
                  </button>
                  <button
                    type="button"
                    className={styles.textButton}
                    disabled={
                      busy ||
                      (!server.enabled && server.clientLifecycle !== 'loaded') ||
                      (server.configuration !== 'ready' && server.clientLifecycle !== 'loaded' && server.clientLifecycle !== 'starting')
                    }
                    onClick={() => void setConnection(server)}
                  >
                    {server.clientLifecycle === 'loaded' || server.clientLifecycle === 'starting' ? t('disconnect') : t('connect')}
                  </button>
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => void toggle(server)}>
                    {server.enabled ? t('disable') : t('enable')}
                  </button>
                  <button type="button" className={styles.iconButton} disabled={busy} onClick={() => void remove(server)} aria-label={t('remove')}>
                    ⌫
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>{t('empty')}</p>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>{t('browse')}</h2>
          <span>{t('registryDisclaimer')}</span>
        </div>
        <div className={styles.searchRow}>
          <input
            className={styles.input}
            value={query}
            onChange={event => {
              setQuery(event.currentTarget.value)
              setRegistryQuery('')
            }}
            placeholder={t('search')}
          />
          <button type="button" className={styles.secondary} disabled={searching || query.trim().length === 0} onClick={() => void search()}>
            {searching ? '…' : t('searchRegistry')}
          </button>
        </div>
        <div className={styles.catalogGrid}>
          {filteredProviders.map(provider => (
            <article className={styles.catalogCard} key={provider.id}>
              <div className={styles.catalogIcon}>{icon(22)}</div>
              <div className={styles.catalogCopy}>
                <div>
                  <strong>{provider.name}</strong>
                  <span className={styles.badge}>{provider.category}</span>
                </div>
                <p>{provider.description}</p>
                <div className={styles.catalogActions}>
                  <a href={provider.docsUrl} target="_blank" rel="noreferrer">
                    {t('docs')}
                  </a>
                  <button type="button" className={styles.secondary} onClick={() => beginProvider(provider.name)}>
                    {t('configure')}
                  </button>
                </div>
              </div>
            </article>
          ))}
          {registryQuery === query.trim()
            ? registry.map((entry, index) => (
                <article className={styles.catalogCard} key={`${entry.name}-${entry.version}-${index}`}>
                  <div className={styles.catalogIcon}>{icon(22)}</div>
                  <div className={styles.catalogCopy}>
                    <div>
                      <strong>{entry.title || entry.name}</strong>
                      <span className={styles.badge}>{entry.category}</span>
                    </div>
                    <p>{entry.description || entry.version}</p>
                    <div className={styles.catalogActions}>
                      {entry.docsUrl ? (
                        <a href={entry.docsUrl} target="_blank" rel="noreferrer">
                          {t('docs')}
                        </a>
                      ) : null}
                      <button type="button" className={styles.secondary} onClick={() => beginProvider(entry.title || entry.name, entry.endpoint ?? '')}>
                        {t('addFromCatalog')}
                      </button>
                    </div>
                  </div>
                </article>
              ))
            : null}
        </div>
        {registryQuery === query.trim() && registry.length === 0 && query.trim().length > 0 ? (
          <p className={styles.emptySmall}>{t('noRegistryResults')}</p>
        ) : null}
        <div className={styles.registryFooter}>
          <span>{t('registryDisclaimer')}</span>
          <a href="https://registry.modelcontextprotocol.io/" target="_blank" rel="noreferrer">
            {t('registry')}
          </a>
        </div>
      </section>
    </div>
  )
}

const ServerEditor = (props: {
  t: T
  draft: ServerDraft
  setDraft: (draft: ServerDraft) => void
  envText: string
  setEnvText: (value: string) => void
  headerText: string
  setHeaderText: (value: string) => void
  startEnvText: string
  setStartEnvText: (value: string) => void
  busy: boolean
  onSave: () => void
  onCancel: () => void
}): JSX.Element => {
  const { t, draft, setDraft } = props
  const set = (key: 'name' | 'serverName' | 'url' | 'commandLine' | 'cwd', value: string) => setDraft({ ...draft, [key]: value } as ServerDraft)
  return (
    <section className={styles.editor}>
      <h2>{draft.id ? t('edit') : t('add')}</h2>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>{t('name')}</span>
          <input className={styles.input} value={draft.name} onChange={event => set('name', event.currentTarget.value)} />
        </label>
        <label className={styles.field}>
          <span>{t('serverName')}</span>
          <input className={styles.input} value={draft.serverName} onChange={event => set('serverName', event.currentTarget.value)} />
          <small>{t('serverNameHint')}</small>
        </label>
        <label className={styles.field}>
          <span>{t('transport')}</span>
          <select
            className={styles.input}
            value={draft.transport}
            onChange={event => {
              const value = event.currentTarget.value
              setDraft(
                value === 'stdio'
                  ? {
                      id: draft.id,
                      name: draft.name,
                      serverName: draft.serverName,
                      enabled: draft.enabled,
                      transport: 'stdio',
                      commandLine: '',
                      cwd: '',
                      envRefs: {},
                    }
                  : { ...blankDraft(draft.name), id: draft.id, serverName: draft.serverName, enabled: draft.enabled },
              )
            }}
          >
            <option value="streamable-http">{t('http')}</option>
            <option value="stdio">{t('stdio')}</option>
          </select>
        </label>
        {draft.transport === 'streamable-http' ? (
          <>
            <label className={styles.field}>
              <span>{t('endpoint')}</span>
              <input
                className={styles.input}
                value={draft.url}
                onChange={event => set('url', event.currentTarget.value)}
                placeholder="https://example.com/mcp"
              />
            </label>
            <label className={styles.fieldWide}>
              <span>{t('headerRefs')}</span>
              <textarea
                className={styles.textarea}
                value={props.headerText}
                onChange={event => props.setHeaderText(event.currentTarget.value)}
                placeholder={'{\n  "Authorization": "FIGMA_TOKEN"\n}'}
              />
            </label>
            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={draft.startCommand !== null && draft.startCommand !== undefined}
                onChange={event => {
                  setDraft({ ...draft, startCommand: event.currentTarget.checked ? { commandLine: '', cwd: '', envRefs: {} } : null })
                }}
              />
              <span>{t('localStart')}</span>
            </label>
            {draft.startCommand ? (
              <>
                <label className={styles.fieldWide}>
                  <span>{t('command')}</span>
                  <input
                    className={styles.input}
                    value={draft.startCommand.commandLine}
                    onChange={event => setDraft({ ...draft, startCommand: { ...draft.startCommand!, commandLine: event.currentTarget.value } })}
                    placeholder={'npx -y @example/local-proxy'}
                  />
                </label>
                <label className={styles.field}>
                  <span>{t('cwd')}</span>
                  <input
                    className={styles.input}
                    value={draft.startCommand.cwd}
                    onChange={event => setDraft({ ...draft, startCommand: { ...draft.startCommand!, cwd: event.currentTarget.value } })}
                    placeholder="/absolute/path"
                  />
                </label>
                <label className={styles.fieldWide}>
                  <span>{t('localEnvRefs')}</span>
                  <textarea
                    className={styles.textarea}
                    value={props.startEnvText}
                    onChange={event => props.setStartEnvText(event.currentTarget.value)}
                    placeholder={'{\n  "ACCESS_TOKEN": "LOCAL_PROXY_TOKEN"\n}'}
                  />
                </label>
              </>
            ) : null}
          </>
        ) : (
          <>
            <label className={styles.fieldWide}>
              <span>{t('command')}</span>
              <input
                className={styles.input}
                value={draft.commandLine}
                onChange={event => set('commandLine', event.currentTarget.value)}
                placeholder={'npx -y @example/mcp-server "an argument"'}
              />
            </label>
            <label className={styles.field}>
              <span>{t('cwd')}</span>
              <input className={styles.input} value={draft.cwd} onChange={event => set('cwd', event.currentTarget.value)} />
            </label>
            <label className={styles.fieldWide}>
              <span>{t('envRefs')}</span>
              <textarea
                className={styles.textarea}
                value={props.envText}
                onChange={event => props.setEnvText(event.currentTarget.value)}
                placeholder={'{\n  "API_TOKEN": "EXAMPLE_TOKEN"\n}'}
              />
            </label>
          </>
        )}
      </div>
      <p className={styles.hint}>{t('referencesHint')}</p>
      <div className={styles.formActions}>
        <button type="button" className={styles.secondary} onClick={props.onCancel}>
          {t('cancel')}
        </button>
        <button type="button" className={styles.primary} disabled={props.busy} onClick={props.onSave}>
          {t('save')}
        </button>
      </div>
    </section>
  )
}
