import { GlobeIcon, PlusIcon, RefreshCwIcon, SearchIcon, SquareTerminalIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Empty, EmptyDescription } from '@dshfiles/plugin-ui/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from '@dshfiles/plugin-ui/components/ui/item'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ServerDraft, ServerView } from './api.js'
import { filterProviders } from './catalog.js'
import type { McpServersTranslate } from './locales.js'
import { ServerEditor } from './server-editor.js'
import { blankServerForm, serverFormFromView, type ServerFormValues } from './server-form.js'
import { useRegistrySearch, useServerActions, useServerSnapshot } from './server-queries.js'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { credentialReferenceSummary, isClientActive, isConnectionToggleBlocked, lifecycleDotClassName, lifecycleText, localProcessText } from './server-status.js'

const REGISTRY_URL = 'https://registry.modelcontextprotocol.io/'
const ALL_CATEGORIES = 'all'

interface EditorState {
  readonly key: number
  readonly values: ServerFormValues
  readonly opened: boolean
}

export const ManagerDialog = (props: { readonly t: McpServersTranslate; readonly open: boolean; readonly onClose: () => void }): JSX.Element => (
  <Dialog
    onOpenChange={open => {
      if (!open) props.onClose()
    }}
    open={props.open}
  >
    <DialogContent
      aria-describedby={undefined}
      className="dshx-root dshx:max-h-[90vh] dshx:overflow-y-auto dshx:p-0 dshx:sm:max-w-[1040px]"
      showCloseButton={false}
    >
      <DialogTitle className="dshx:sr-only">{props.t('title')}</DialogTitle>
      <ManagerView onClose={props.onClose} t={props.t} />
    </DialogContent>
  </Dialog>
)

export const ManagerView = ({ t, onClose }: { readonly t: McpServersTranslate; readonly onClose?: () => void }): JSX.Element => {
  const snapshot = useServerSnapshot()
  const actions = useServerActions()
  const [editor, setEditor] = useState<EditorState>({ key: 0, values: blankServerForm(), opened: false })
  const editorRef = useRef<HTMLDivElement>(null)
  const [pendingRemoval, setPendingRemoval] = useState<ServerView | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORIES)
  const [submittedRegistryQuery, setSubmittedRegistryQuery] = useState('')
  const registry = useRegistrySearch(submittedRegistryQuery)
  const trimmedQuery = query.trim()
  const servers = snapshot.data?.servers ?? []
  const enabledCount = servers.filter(server => server.enabled).length
  const providers = snapshot.data?.providers ?? []
  const categories = [...new Set(providers.map(provider => provider.category))]
  const inCategory = (row: { readonly category: string }): boolean => category === ALL_CATEGORIES || row.category === category
  const filteredProviders = filterProviders(providers, query).filter(inCategory)
  const registryResults = (submittedRegistryQuery === trimmedQuery && registry.isSuccess ? registry.data : []).filter(inCategory)
  const showsNoRegistryResults = submittedRegistryQuery === trimmedQuery && trimmedQuery.length > 0 && registry.isSuccess && registry.data.length === 0

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
  const searchRegistry = (): void => {
    if (trimmedQuery.length === 0) return
    setSubmittedRegistryQuery(trimmedQuery)
    if (submittedRegistryQuery === trimmedQuery) void registry.refetch()
  }

  return (
    <div className="dshx-root dshx:mx-auto dshx:flex dshx:w-full dshx:max-w-[1040px] dshx:flex-col dshx:gap-6 dshx:px-6 dshx:pt-8 dshx:pb-12">
      <header className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-4">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
          <h1 className="dshx:text-xl dshx:font-semibold">{t('pageTitle')}</h1>
          <p className="dshx:text-sm dshx:text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2">
          <Button disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()} variant="secondary">
            {snapshot.isFetching ? <Spinner /> : <RefreshCwIcon className="dshx:size-4" />}
            {t('refresh')}
          </Button>
          {onClose ? (
            <Button onClick={onClose} variant="ghost">
              {t('close')}
            </Button>
          ) : null}
        </div>
      </header>

      {snapshot.isError || actions.failed || registry.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('error')}</AlertDescription>
        </Alert>
      ) : null}

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

      <Card>
        <CardHeader>
          <CardTitle className="dshx:text-sm">{t('browse')}</CardTitle>
          <CardDescription className="dshx:text-xs">{t('registryDisclaimer')}</CardDescription>
        </CardHeader>
        <CardContent className="dshx:flex dshx:flex-col dshx:gap-3">
          <form
            className="dshx:flex dshx:gap-2"
            onSubmit={event => {
              event.preventDefault()
              searchRegistry()
            }}
          >
            <InputGroup className="dshx:flex-1">
              <InputGroupAddon>
                <SearchIcon className="dshx:size-3.5" />
              </InputGroupAddon>
              <InputGroupInput aria-label={t('search')} onChange={event => setQuery(event.currentTarget.value)} placeholder={t('search')} value={query} />
            </InputGroup>
            <Button disabled={registry.isFetching || trimmedQuery.length === 0} type="submit" variant="outline">
              {registry.isFetching ? <Spinner /> : null}
              {t('searchRegistry')}
            </Button>
          </form>
          {categories.length > 1 ? (
            <ToggleGroup
              aria-label={t('providers')}
              className="dshx:flex-wrap"
              onValueChange={value => setCategory(value === '' ? ALL_CATEGORIES : value)}
              size="sm"
              spacing={1}
              type="single"
              value={category}
              variant="outline"
            >
              <ToggleGroupItem className="dshx:px-2.5 dshx:text-xs" value={ALL_CATEGORIES}>
                {t('allCategories')}
              </ToggleGroupItem>
              {categories.map(name => (
                <ToggleGroupItem className="dshx:px-2.5 dshx:text-xs" key={name} value={name}>
                  {name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
          <div className="dshx:grid dshx:gap-3 dshx:md:grid-cols-2 dshx:xl:grid-cols-3">
            <button
              className="dshx:flex dshx:items-center dshx:gap-3 dshx:rounded-lg dshx:border dshx:border-dashed dshx:p-4 dshx:text-left dshx:transition-colors dshx:outline-none dshx:hover:bg-accent/50 dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50"
              onClick={() => openEditor(blankServerForm({ name: t('custom') }))}
              type="button"
            >
              <span className="dshx:flex dshx:size-9 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:bg-muted dshx:text-muted-foreground">
                <PlusIcon className="dshx:size-4" />
              </span>
              <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
                <span className="dshx:text-sm dshx:font-medium">{t('custom')}</span>
                <span className="dshx:text-xs dshx:text-muted-foreground">{t('customDescription')}</span>
              </span>
            </button>
            {filteredProviders.map(provider => (
              <CatalogCard
                action={
                  <Button onClick={() => openEditor(blankServerForm({ name: provider.name }))} size="sm" variant="outline">
                    {t('configure')}
                  </Button>
                }
                category={provider.category}
                description={provider.description}
                docsUrl={provider.docsUrl}
                key={provider.id}
                t={t}
                title={provider.name}
              />
            ))}
            {registryResults.map((entry, index) => (
              <CatalogCard
                action={
                  <Button
                    onClick={() => openEditor(blankServerForm({ name: entry.title || entry.name, endpoint: entry.endpoint ?? '' }))}
                    size="sm"
                    variant="outline"
                  >
                    {t('addFromCatalog')}
                  </Button>
                }
                category={entry.category}
                description={entry.description || entry.version}
                docsUrl={entry.docsUrl}
                key={`${entry.name}-${entry.version}-${index}`}
                t={t}
                title={entry.title || entry.name}
              />
            ))}
          </div>
          {showsNoRegistryResults ? (
            <Empty className="dshx:p-4">
              <EmptyDescription>{t('noRegistryResults')}</EmptyDescription>
            </Empty>
          ) : null}
        </CardContent>
        <CardFooter className="dshx:justify-end dshx:border-t">
          <a className="dshx:text-xs dshx:text-muted-foreground dshx:underline dshx:underline-offset-4 dshx:hover:text-foreground" href={REGISTRY_URL} rel="noreferrer" target="_blank">
            {t('registry')}
          </a>
        </CardFooter>
      </Card>

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
          {server.configuration === 'ready' ? null : (
            <Badge variant="warning">
              {t('needsCredentials')}
            </Badge>
          )}
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
        <Button disabled={props.busy || isConnectionToggleBlocked(server)} onClick={props.onToggleConnection} size="sm" variant="outline">
          {isClientActive(server) ? t('disconnect') : t('connect')}
        </Button>
        <Button disabled={props.busy} onClick={props.onToggleEnabled} size="sm" variant="secondary">
          {server.enabled ? t('disable') : t('enable')}
        </Button>
        <Button aria-label={t('remove')} className="dshx:text-muted-foreground dshx:hover:text-destructive" disabled={props.busy} onClick={props.onRemove} size="icon-sm" variant="ghost">
          <Trash2Icon className="dshx:size-4" />
        </Button>
      </ItemActions>
    </Item>
  )
}

interface CatalogCardProps {
  readonly t: McpServersTranslate
  readonly title: string
  readonly category: string
  readonly description: string
  readonly docsUrl: string | null
  readonly action: ReactNode
}

const CatalogCard = (props: CatalogCardProps): JSX.Element => (
  <article className="dshx:flex dshx:gap-3 dshx:rounded-lg dshx:border dshx:p-4">
    <span
      aria-hidden
      className="dshx:flex dshx:size-9 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:bg-muted dshx:text-sm dshx:font-semibold dshx:text-muted-foreground"
    >
      {props.title.slice(0, 1).toLocaleUpperCase()}
    </span>
    <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <h3 className="dshx:text-sm dshx:font-medium">{props.title}</h3>
        <Badge variant="muted">{props.category}</Badge>
      </div>
      <p className="dshx:line-clamp-2 dshx:text-xs dshx:text-muted-foreground">{props.description}</p>
      <div className="dshx:mt-auto dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:pt-2">
        {props.docsUrl ? (
          <a className="dshx:text-xs dshx:text-muted-foreground dshx:underline dshx:underline-offset-4 dshx:hover:text-foreground" href={props.docsUrl} rel="noreferrer" target="_blank">
            {props.t('docs')}
          </a>
        ) : (
          <span />
        )}
        {props.action}
      </div>
    </div>
  </article>
)
