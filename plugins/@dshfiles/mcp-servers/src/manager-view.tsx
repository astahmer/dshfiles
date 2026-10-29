import { GlobeIcon, LibraryIcon, RefreshCwIcon, SquareTerminalIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Empty, EmptyDescription } from '@dshfiles/plugin-ui/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from '@dshfiles/plugin-ui/components/ui/item'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { useApi } from '@dshfiles/dshx/client'
import { ListSelectionModel, type ListSelection } from '@dshfiles/plugin-ui/hooks/list-selection'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { CatalogBrowser, SignInNotice, type CustomServerRequest } from './catalog-browser.js'
import { mcpServersApi, type ServerDraft, type ServerView } from './api.js'
import type { McpServersTranslate } from './locales.js'
import { PreferencesForm } from './preferences-form.js'
import { ServerEditor, ServerEditorDialog } from './server-editor.js'
import { McpServerFormModel, type ServerFormValues } from './server-form.js'
import { ServerSelectionModel } from './server-selection.js'
import { useServerActions, useServerSnapshot } from './server-queries.js'
import { McpServerStatusModel } from './server-status.js'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'

interface EditorState {
  readonly key: number
  readonly values: ServerFormValues
  readonly opened: boolean
}

export const ManagerView = ({ t }: { readonly t: McpServersTranslate }): JSX.Element => {
  const snapshot = useServerSnapshot({ reconcile: true })
  const actions = useServerActions()
  const api = useApi(mcpServersApi)
  const [editor, setEditor] = useState<EditorState>({ key: 0, values: McpServerFormModel.blankServerForm(), opened: false })
  const editorRef = useRef<HTMLDivElement>(null)
  const [pendingRemoval, setPendingRemoval] = useState<readonly ServerView[]>([])
  const [selection, setSelection] = useState<ListSelection<string>>(() => ListSelectionModel.empty())
  const [batchPending, setBatchPending] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [custom, setCustom] = useState<(CustomServerRequest & { readonly key: number }) | null>(null)
  const servers = useMemo(() => snapshot.data?.servers ?? [], [snapshot.data])
  const enabledCount = servers.filter(server => server.enabled).length
  const orderedServerIds = useMemo(() => servers.map(server => server.id), [servers])
  const selectedServerIds = useMemo(() => new Set(selection.ids), [selection.ids])
  const selectedServers = useMemo(() => ServerSelectionModel.selected({ servers, ids: selection.ids }), [servers, selection.ids])
  useEffect(() => {
    setSelection(current => {
      const next = ListSelectionModel.prune({ state: current, visibleIds: orderedServerIds })
      return next.ids.length === current.ids.length && next.anchorId === current.anchorId ? current : next
    })
  }, [orderedServerIds])

  useEffect(() => {
    if (editor.opened) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editor.key, editor.opened])

  const openEditor = (values: ServerFormValues): void => {
    actions.resetErrors()
    setEditor(current => ({ key: current.key + 1, values, opened: true }))
  }
  const resetEditor = (): void => setEditor(current => ({ key: current.key + 1, values: McpServerFormModel.blankServerForm(), opened: false }))
  const save = async (draft: ServerDraft): Promise<void> => {
    if (await actions.save(draft)) resetEditor()
  }
  const clearSelection = (): void => setSelection(ListSelectionModel.empty())
  const toggleServer = (id: string): void => setSelection(current => ListSelectionModel.toggle({ state: current, id }))
  const extendServer = (id: string): void => setSelection(current => ListSelectionModel.extend({ state: current, orderedIds: orderedServerIds, id }))
  const setEnabledForSelection = async (enabled: boolean): Promise<void> => {
    const targets = ServerSelectionModel.targets({ servers, ids: selection.ids, enabled })
    if (targets.length === 0) return
    setBatchPending(true)
    setBatchError(null)
    try {
      for (const server of targets) await api.setEnabled({ id: server.id, enabled })
      clearSelection()
      await snapshot.refetch()
    } catch (error) {
      setBatchError(errorMessage(error, t('error')))
    } finally {
      setBatchPending(false)
    }
  }
  const removeServers = async (targets: readonly ServerView[]): Promise<void> => {
    if (targets.length === 0) return
    setBatchPending(true)
    setBatchError(null)
    try {
      for (const server of targets) await api.remove({ id: server.id })
      setPendingRemoval([])
      clearSelection()
      await snapshot.refetch()
    } catch (error) {
      setBatchError(errorMessage(error, t('error')))
    } finally {
      setBatchPending(false)
    }
  }
  const confirmRemoval = (): void => {
    void removeServers(pendingRemoval)
  }

  return (
    <div className="dshx-root dshx:@container dshx:h-full dshx:min-h-0 dshx:overflow-y-auto">
      <div className="dshx:mx-auto dshx:flex dshx:w-full dshx:max-w-[1040px] dshx:flex-col dshx:gap-6 dshx:px-6 dshx:pt-8 dshx:pb-12 dshx:@max-pane-narrow:gap-4 dshx:@max-pane-narrow:px-3 dshx:@max-pane-narrow:pt-4">
        <header className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-4 dshx:@max-pane-compact:flex-col dshx:@max-pane-compact:gap-3">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
            <h1 className="dshx:text-xl dshx:font-semibold">{t('pageTitle')}</h1>
            <p className="dshx:text-sm dshx:text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="dshx:flex dshx:shrink-0 dshx:flex-wrap dshx:items-center dshx:gap-2">
            <Button onClick={() => setBrowsing(true)} variant="outline">
              <LibraryIcon className="dshx:size-4" />
              {t('browseCatalog')}
            </Button>
            <Button disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()} variant="secondary">
              {snapshot.isFetching ? <Spinner /> : <RefreshCwIcon className="dshx:size-4" />}
              {t('refresh')}
            </Button>
          </div>
        </header>

        {snapshot.isError || actions.failed || batchError !== null ? (
          <Alert variant="destructive">
            <AlertDescription>{batchError ?? t('error')}</AlertDescription>
          </Alert>
        ) : null}
        <SignInNotice actions={actions} t={t} />

        <div className="dshx:scroll-mt-4" ref={editorRef}>
          <ServerEditor defaultValues={editor.values} key={editor.key} onCancel={editor.opened ? resetEditor : undefined} onSave={save} t={t} />
        </div>

        <section aria-labelledby="mcp-registered-servers" className="dshx:flex dshx:flex-col dshx:gap-3">
          <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2">
            <h2 className="dshx:text-sm dshx:font-semibold" id="mcp-registered-servers">
              {t('configuredServers')}
            </h2>
            <span className="dshx:text-xs dshx:text-muted-foreground">{snapshot.data ? `${enabledCount} ${t('enabledCount')}` : '…'}</span>
          </div>
          {servers.length === 0 ? null : (
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs">
              <label className="dshx:flex dshx:items-center dshx:gap-1">
                <input
                  type="checkbox"
                  aria-label={t('selectAllServers')}
                  checked={ListSelectionModel.isComplete({ state: selection, orderedIds: orderedServerIds })}
                  onChange={() => setSelection(current => ListSelectionModel.toggleAllVisible({ state: current, orderedIds: orderedServerIds }))}
                  className="dshx:size-3.5 dshx:accent-[var(--color-info)]"
                />
                {t('selectAllServers')}
              </label>
              {selection.ids.length === 0 ? null : (
                <span className="dshx:ml-auto dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
                  <span className="dshx:mr-1 dshx:tabular-nums">{t('selectedServers', { count: selection.ids.length })}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={batchPending || selectedServers.every(server => server.enabled)}
                    onClick={() => void setEnabledForSelection(true)}
                  >
                    {t('enableSelected')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={batchPending || selectedServers.every(server => !server.enabled)}
                    onClick={() => void setEnabledForSelection(false)}
                  >
                    {t('disableSelected')}
                  </Button>
                  <Button size="sm" variant="destructive" disabled={batchPending} onClick={() => setPendingRemoval(selectedServers)}>
                    {t('removeSelected')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelection}>
                    {t('clearSelection')}
                  </Button>
                </span>
              )}
            </div>
          )}
          <div className="dshx:rounded-lg dshx:border dshx:bg-card">
            {servers.length > 0 ? (
              <ItemGroup>
                {servers.map((server, index) => (
                  <Fragment key={server.id}>
                    {index > 0 ? <ItemSeparator /> : null}
                    <ServerItem
                      busy={actions.isPending || batchPending}
                      selected={selectedServerIds.has(server.id)}
                      onRangeSelection={extendServer}
                      onToggleSelection={toggleServer}
                      onEdit={() => openEditor(McpServerFormModel.serverFormFromView(server))}
                      onRemove={() => setPendingRemoval([server])}
                      onSignIn={() => actions.signIn(server)}
                      onSignOut={() => actions.signOut(server)}
                      onToggleConnection={() => actions.toggleConnection(server)}
                      onToggleEnabled={() => actions.toggleEnabled(server)}
                      server={server}
                      t={t}
                    />
                  </Fragment>
                ))}
              </ItemGroup>
            ) : (
              <Empty className="dshx:py-10">
                <EmptyDescription>{snapshot.isPending ? <Spinner className="dshx:mx-auto" /> : t('empty')}</EmptyDescription>
              </Empty>
            )}
          </div>
        </section>

        {snapshot.data === undefined ? null : <PreferencesForm preferences={snapshot.data.preferences} t={t} />}
      </div>

      <CatalogBrowser
        actions={actions}
        onClose={() => setBrowsing(false)}
        onCustom={request => {
          setBrowsing(false)
          setCustom(current => ({ ...request, key: (current?.key ?? 0) + 1 }))
        }}
        open={browsing}
        snapshot={snapshot.data}
        t={t}
      />
      {custom === null ? null : (
        <ServerEditorDialog
          hint={custom.hint}
          key={custom.key}
          onClose={() => setCustom(null)}
          onSave={async draft => {
            if (await actions.save(draft)) setCustom(null)
          }}
          open
          t={t}
          values={custom.values}
        />
      )}

      <AlertDialog
        onOpenChange={open => {
          if (!open && !batchPending) setPendingRemoval([])
        }}
        open={pendingRemoval.length > 0}
      >
        <AlertDialogContent className="dshx-root" size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="dshx:text-sm">
              {pendingRemoval.length === 1 ? t('confirmRemove') : t('confirmRemoveMany', { count: pendingRemoval.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('confirmRemoveDetail')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={batchPending}
              onClick={event => {
                event.preventDefault()
                confirmRemoval()
              }}
              variant="destructive"
            >
              {batchPending ? <Spinner /> : null}
              {pendingRemoval.length === 1 ? t('remove') : t('removeSelected')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface ServerItemProps {
  readonly t: McpServersTranslate
  readonly server: ServerView
  readonly busy: boolean
  readonly selected: boolean
  readonly onToggleSelection: (id: string) => void
  readonly onRangeSelection: (id: string) => void
  readonly onEdit: () => void
  readonly onToggleConnection: () => void
  readonly onToggleEnabled: () => void
  readonly onRemove: () => void
  readonly onSignIn: () => void
  readonly onSignOut: () => void
}

const ServerItem = ({ t, server, ...props }: ServerItemProps): JSX.Element => {
  const processText = McpServerStatusModel.localProcessText({ server, t })
  const modifiedCheckboxClick = useRef(false)
  return (
    <Item role="listitem">
      <input
        type="checkbox"
        aria-label={`${t('selectServer')} ${server.name}`}
        checked={props.selected}
        onClick={event => {
          if (!event.shiftKey && !event.metaKey && !event.ctrlKey) return
          modifiedCheckboxClick.current = true
          event.stopPropagation()
          if (event.shiftKey) props.onRangeSelection(server.id)
          else props.onToggleSelection(server.id)
        }}
        onChange={() => {
          if (modifiedCheckboxClick.current) {
            modifiedCheckboxClick.current = false
            return
          }
          props.onToggleSelection(server.id)
        }}
        className="dshx:size-3.5 dshx:shrink-0 dshx:accent-[var(--color-info)]"
      />
      <ItemMedia className="dshx:size-10 dshx:rounded-lg dshx:border-0 dshx:text-muted-foreground" variant="icon">
        {server.transport === 'stdio' ? <SquareTerminalIcon className="dshx:size-[18px]" /> : <GlobeIcon className="dshx:size-[18px]" />}
      </ItemMedia>
      <ItemContent className="dshx:min-w-0 dshx:gap-0.5">
        <ItemTitle>
          {server.name}
          {server.enabled ? null : <Badge variant="muted">{t('disabled')}</Badge>}
          {server.oauth === 'needs-sign-in' ? <Badge variant="warning">{t('signInRequired')}</Badge> : null}
          {server.oauth === 'signed-in' ? <Badge variant="muted">{t('signedIn')}</Badge> : null}
          {server.configuration === 'ready' || server.oauth === 'needs-sign-in' ? null : <Badge variant="warning">{t('needsCredentials')}</Badge>}
        </ItemTitle>
        <ItemDescription className="dshx:truncate dshx:font-mono dshx:text-xs">
          {server.transport === 'stdio' ? server.commandLine : server.url}
        </ItemDescription>
        <p className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
          <StatusDot size="sm" className={McpServerStatusModel.lifecycleDotClassName(server)} />
          {McpServerStatusModel.lifecycleText({ server, t })} · {server.registeredToolCount} {t('registeredTools')}
          {processText ? ` · ${processText}` : null}
        </p>
        <p className="dshx:text-xs dshx:text-muted-foreground">{t('connectionUnknown')}</p>
        {server.credentialReferences.length > 0 ? (
          <p className="dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">
            {t('references')}: {McpServerStatusModel.credentialReferenceSummary(server)}
          </p>
        ) : null}
      </ItemContent>
      <ItemActions>
        <Button onClick={props.onEdit} size="sm" variant="ghost">
          {t('edit')}
        </Button>
        {server.oauth === 'needs-sign-in' ? (
          <Button disabled={props.busy || !server.enabled} onClick={props.onSignIn} size="sm" variant="outline">
            {t('signIn')}
          </Button>
        ) : (
          <Button
            disabled={props.busy || McpServerStatusModel.isConnectionToggleBlocked(server)}
            onClick={props.onToggleConnection}
            size="sm"
            variant="outline"
          >
            {McpServerStatusModel.isClientActive(server) ? t('disconnect') : t('connect')}
          </Button>
        )}
        {server.oauth === 'signed-in' ? (
          <Button disabled={props.busy} onClick={props.onSignOut} size="sm" variant="ghost">
            {t('signOut')}
          </Button>
        ) : null}
        <Button disabled={props.busy} onClick={props.onToggleEnabled} size="sm" variant={server.enabled ? 'default' : 'outline'}>
          {server.enabled ? t('disable') : t('enable')}
        </Button>
        <Button
          aria-label={t('remove')}
          className="dshx:text-muted-foreground dshx:hover:text-destructive"
          disabled={props.busy}
          onClick={props.onRemove}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2Icon className="dshx:size-4" />
        </Button>
      </ItemActions>
    </Item>
  )
}
