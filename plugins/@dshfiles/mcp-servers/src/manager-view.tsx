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
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { EmptyState, Page, PageSection } from '@dshfiles/plugin-ui/components/page'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { useApi } from '@dshfiles/dshx/client'
import { ListSelectionModel, type ListSelection } from '@dshfiles/plugin-ui/hooks/list-selection'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CatalogBrowser, SignInNotice, type CustomServerRequest } from './catalog-browser.js'
import { mcpServersApi, type ServerDraft, type ServerView } from './api.js'
import type { McpServersTranslate } from './locales.js'
import { PreferencesForm } from './preferences-form.js'
import { ServerEditor, ServerEditorDialog } from './server-editor.js'
import { McpServerFormModel, type ServerFormValues } from './server-form.js'
import { ServerSelectionModel } from './server-selection.js'
import { useServerActions, useServerSnapshot } from './server-queries.js'
import { McpServerStatusModel } from './server-status.js'

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
    <Page
      scroll
      heading={t('pageTitle')}
      description={t('subtitle')}
      // The add-server form's submit is this page's one primary action, so the header carries secondary ones only.
      actions={[
        { id: 'browse', label: t('browseCatalog'), icon: <LibraryIcon aria-hidden />, onSelect: () => setBrowsing(true) },
        { id: 'refresh', label: t('refresh'), icon: <RefreshCwIcon aria-hidden />, pending: snapshot.isFetching, onSelect: () => void snapshot.refetch() },
      ]}
      bodyClassName="dshx:gap-6 dshx:@max-pane-narrow:gap-4"
    >
      {snapshot.isError || actions.failed || batchError !== null ? (
        <Alert variant="destructive">
          <AlertDescription>{batchError ?? t('error')}</AlertDescription>
        </Alert>
      ) : null}
      <SignInNotice actions={actions} t={t} />

      <div className="dshx:scroll-mt-4" ref={editorRef}>
        <ServerEditor defaultValues={editor.values} key={editor.key} onCancel={editor.opened ? resetEditor : undefined} onSave={save} t={t} />
      </div>

      <PageSection heading={t('configuredServers')} meta={snapshot.data ? `${enabledCount} ${t('enabledCount')}` : '…'}>
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
        {servers.length > 0 ? (
          <EntityList>
            {servers.map(server => (
              <ServerItem
                key={server.id}
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
            ))}
          </EntityList>
        ) : (
          <div className="dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card">
            {snapshot.isPending ? (
              <div className="dshx:flex dshx:justify-center dshx:py-8">
                <Spinner />
              </div>
            ) : (
              <EmptyState>{t('empty')}</EmptyState>
            )}
          </div>
        )}
      </PageSection>

      {snapshot.data === undefined ? null : <PreferencesForm preferences={snapshot.data.preferences} t={t} />}

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
    </Page>
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

/** Server states on the shared vocabulary; the lifecycle line keeps the exact client state as text. */
const serverStatus = (server: ServerView): WorkStatus => {
  if (server.clientLifecycle === 'start-failed') return 'failed'
  if (server.enabled && (server.oauth === 'needs-sign-in' || server.configuration !== 'ready')) return 'needs-you'
  if (server.clientLifecycle === 'starting') return 'working'
  return 'idle'
}

const ServerItem = ({ t, server, ...props }: ServerItemProps): JSX.Element => {
  const processText = McpServerStatusModel.localProcessText({ server, t })
  const modifiedCheckboxClick = useRef(false)
  const TransportIcon = server.transport === 'stdio' ? SquareTerminalIcon : GlobeIcon
  return (
    <EntityRow
      role="listitem"
      status={serverStatus(server)}
      statusDecorative
      selected={props.selected}
      leading={
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
      }
      heading={<span className="dshx:font-medium">{server.name}</span>}
      meta={
        <>
          {server.enabled ? null : <Badge variant="muted">{t('disabled')}</Badge>}
          {server.oauth === 'needs-sign-in' ? <Badge variant="outline">{t('signInRequired')}</Badge> : null}
          {server.oauth === 'signed-in' ? <Badge variant="muted">{t('signedIn')}</Badge> : null}
          {server.configuration === 'ready' || server.oauth === 'needs-sign-in' ? null : <Badge variant="outline">{t('needsCredentials')}</Badge>}
        </>
      }
      description={
        <>
          <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
            <TransportIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
            <span className="dshx:truncate dshx:font-mono">{server.transport === 'stdio' ? server.commandLine : server.url}</span>
          </span>
          <span>
            {McpServerStatusModel.lifecycleText({ server, t })} · {server.registeredToolCount} {t('registeredTools')}
            {processText ? ` · ${processText}` : null}
          </span>
          <span>{t('connectionUnknown')}</span>
          {server.credentialReferences.length > 0 ? (
            <span className="dshx:truncate dshx:font-mono">
              {t('references')}: {McpServerStatusModel.credentialReferenceSummary(server)}
            </span>
          ) : null}
        </>
      }
      trailing={
        <>
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
          <Button disabled={props.busy} onClick={props.onToggleEnabled} size="sm" variant="outline">
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
        </>
      }
    />
  )
}
