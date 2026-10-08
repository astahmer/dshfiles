import { GlobeIcon, LibraryIcon, RefreshCwIcon, SquareTerminalIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Empty, EmptyDescription } from '@dshfiles/plugin-ui/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from '@dshfiles/plugin-ui/components/ui/item'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Fragment, useEffect, useRef, useState } from 'react'
import { CatalogBrowser, SignInNotice, type CustomServerRequest } from './catalog-browser.js'
import type { ServerDraft, ServerView } from './api.js'
import type { McpServersTranslate } from './locales.js'
import { ServerEditor, ServerEditorDialog } from './server-editor.js'
import { blankServerForm, serverFormFromView, type ServerFormValues } from './server-form.js'
import { useServerActions, useServerSnapshot } from './server-queries.js'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { credentialReferenceSummary, isClientActive, isConnectionToggleBlocked, lifecycleDotClassName, lifecycleText, localProcessText } from './server-status.js'

interface EditorState {
  readonly key: number
  readonly values: ServerFormValues
  readonly opened: boolean
}

export const ManagerView = ({ t }: { readonly t: McpServersTranslate }): JSX.Element => {
  const snapshot = useServerSnapshot()
  const actions = useServerActions()
  const [editor, setEditor] = useState<EditorState>({ key: 0, values: blankServerForm(), opened: false })
  const editorRef = useRef<HTMLDivElement>(null)
  const [pendingRemoval, setPendingRemoval] = useState<ServerView | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [custom, setCustom] = useState<(CustomServerRequest & { readonly key: number }) | null>(null)
  const servers = snapshot.data?.servers ?? []
  const enabledCount = servers.filter(server => server.enabled).length

  useEffect(() => {
    if (editor.opened) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editor.key, editor.opened])

  const openEditor = (values: ServerFormValues): void => {
    actions.resetErrors()
    setEditor(current => ({ key: current.key + 1, values, opened: true }))
  }
  const resetEditor = (): void => setEditor(current => ({ key: current.key + 1, values: blankServerForm(), opened: false }))
  const save = async (draft: ServerDraft): Promise<void> => {
    if (await actions.save(draft)) resetEditor()
  }
  const confirmRemoval = (): void => {
    if (pendingRemoval === null) return
    actions.remove({ server: pendingRemoval, onSettled: () => setPendingRemoval(null) })
  }

  return (
    <div className="dshx-root dshx:h-full dshx:min-h-0 dshx:overflow-y-auto">
      <div className="dshx:mx-auto dshx:flex dshx:w-full dshx:max-w-[1040px] dshx:flex-col dshx:gap-6 dshx:px-6 dshx:pt-8 dshx:pb-12">
        <header className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-4">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
            <h1 className="dshx:text-xl dshx:font-semibold">{t('pageTitle')}</h1>
            <p className="dshx:text-sm dshx:text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2">
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

        {snapshot.isError || actions.failed ? (
          <Alert variant="destructive">
            <AlertDescription>{t('error')}</AlertDescription>
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
          <div className="dshx:rounded-lg dshx:border dshx:bg-card">
            {servers.length > 0 ? (
              <ItemGroup>
                {servers.map((server, index) => (
                  <Fragment key={server.id}>
                    {index > 0 ? <ItemSeparator /> : null}
                    <ServerItem
                      busy={actions.isPending}
                      onEdit={() => openEditor(serverFormFromView(server))}
                      onRemove={() => setPendingRemoval(server)}
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
          if (!open && !actions.isRemoving) setPendingRemoval(null)
        }}
        open={pendingRemoval !== null}
      >
        <AlertDialogContent className="dshx-root" size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="dshx:text-sm">{t('confirmRemove')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actions.isRemoving}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={actions.isRemoving}
              onClick={event => {
                event.preventDefault()
                confirmRemoval()
              }}
              variant="destructive"
            >
              {actions.isRemoving ? <Spinner /> : null}
              {t('remove')}
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
  readonly onEdit: () => void
  readonly onToggleConnection: () => void
  readonly onToggleEnabled: () => void
  readonly onRemove: () => void
  readonly onSignIn: () => void
  readonly onSignOut: () => void
}

const ServerItem = ({ t, server, ...props }: ServerItemProps): JSX.Element => {
  const processText = localProcessText(server, t)
  return (
    <Item role="listitem">
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
        <ItemDescription className="dshx:truncate dshx:font-mono dshx:text-xs">{server.transport === 'stdio' ? server.commandLine : server.url}</ItemDescription>
        <p className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
          <span aria-hidden className={cn('dshx:size-1.5 dshx:shrink-0 dshx:rounded-full', lifecycleDotClassName(server))} />
          {lifecycleText(server, t)} · {server.registeredToolCount} {t('registeredTools')}
          {processText ? ` · ${processText}` : null}
        </p>
        <p className="dshx:text-xs dshx:text-muted-foreground">{t('connectionUnknown')}</p>
        {server.credentialReferences.length > 0 ? (
          <p className="dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">
            {t('references')}: {credentialReferenceSummary(server)}
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
          <Button disabled={props.busy || isConnectionToggleBlocked(server)} onClick={props.onToggleConnection} size="sm" variant="outline">
            {isClientActive(server) ? t('disconnect') : t('connect')}
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
        <Button aria-label={t('remove')} className="dshx:text-muted-foreground dshx:hover:text-destructive" disabled={props.busy} onClick={props.onRemove} size="icon-sm" variant="ghost">
          <Trash2Icon className="dshx:size-4" />
        </Button>
      </ItemActions>
    </Item>
  )
}
