import { GlobeIcon, PlusIcon, SearchIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { useState, type ReactNode } from 'react'
import type { ManagerSnapshot } from './api.js'
import { McpCatalogModel } from './catalog.js'
import type { McpServersTranslate } from './locales.js'
import { providerIcons } from './provider-icons.js'
import { McpServerFormModel, type ServerFormValues } from './server-form.js'
import { useRegistrySearch, type ServerActions } from './server-queries.js'

const REGISTRY_URL = 'https://registry.modelcontextprotocol.io/'
const REGISTRY_DEBOUNCE_MS = 300

type Provider = ManagerSnapshot['providers'][number]

export interface CustomServerRequest {
  readonly values: ServerFormValues
  readonly hint: string | undefined
}

/** Link to finish an OAuth sign-in when the browser blocked the provider tab. */
export const SignInNotice = (props: { readonly t: McpServersTranslate; readonly actions: ServerActions; readonly className?: string }): JSX.Element | null =>
  props.actions.authorizationUrl === null ? null : (
    <Alert className={cn('dshx:flex dshx:items-center dshx:gap-3', props.className)} role="status">
      <AlertDescription className="dshx:flex-1">{props.t('signInHint')}</AlertDescription>
      <a
        className="dshx:shrink-0 dshx:text-sm dshx:font-medium dshx:underline dshx:underline-offset-4"
        href={props.actions.authorizationUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        {props.t('continueSignIn')}
      </a>
      <Button aria-label={props.t('dismiss')} onClick={props.actions.dismissAuthorization} size="icon-xs" variant="ghost">
        <XIcon />
      </Button>
    </Alert>
  )

const ProviderMark = (props: { readonly id: string }): JSX.Element => {
  const icon = providerIcons[props.id] ?? providerIcons[props.id.split('-')[0] ?? '']
  return (
    <span
      aria-hidden
      className={cn(
        'dshx:flex dshx:size-9 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:p-1.5',
        icon?.tile === 'light' ? 'dshx:bg-white' : 'dshx:bg-muted dshx:text-muted-foreground',
      )}
    >
      {icon === undefined ? (
        <GlobeIcon className="dshx:size-5" />
      ) : (
        <img alt="" className="dshx:size-6 dshx:object-contain" src={`data:image/svg+xml,${encodeURIComponent(icon.svg)}`} />
      )}
    </span>
  )
}

const CatalogCard = (props: {
  readonly mark: ReactNode
  readonly title: string
  readonly badge: string
  readonly description: string
  readonly footer: ReactNode
  readonly action: ReactNode
}): JSX.Element => (
  <article className="dshx:flex dshx:min-h-24 dshx:items-center dshx:gap-2.5 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-2.5">
    {props.mark}
    <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
        <h3 className="dshx:truncate dshx:text-sm dshx:font-medium">{props.title}</h3>
        <Badge className="dshx:shrink-0 dshx:text-[10px]" variant="muted">
          {props.badge}
        </Badge>
      </div>
      <p className="dshx:mt-0.5 dshx:line-clamp-2 dshx:text-xs dshx:text-muted-foreground">{props.description}</p>
      <div className="dshx:mt-2 dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-between dshx:gap-2">
        {props.footer}
        {props.action}
      </div>
    </div>
  </article>
)

export const CatalogBrowser = (props: {
  readonly t: McpServersTranslate
  readonly open: boolean
  readonly snapshot: ManagerSnapshot | undefined
  readonly actions: ServerActions
  readonly onClose: () => void
  readonly onCustom: (request: CustomServerRequest) => void
}): JSX.Element => {
  const t = props.t
  const [search, setSearch] = useState('')
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  const registryEnabled = props.snapshot?.registrySearch ?? true
  const trimmed = search.trim()
  const registryQuery = useDebouncedValue({ value: trimmed, delayMs: REGISTRY_DEBOUNCE_MS })
  const registry = useRegistrySearch(registryQuery, props.open && registryEnabled)

  const servers = props.snapshot?.servers ?? []
  const registered = new Set(servers.flatMap(server => (server.transport === 'stdio' ? [] : [McpCatalogModel.endpointKey(server.url)])))
  const providers = McpCatalogModel.filterProviders({ rows: props.snapshot?.providers ?? [], query: search })
  const providerKeys = new Set(providers.map(provider => McpCatalogModel.endpointKey(provider.url)))
  const registryRows =
    registryQuery === trimmed && registry.isSuccess
      ? registry.data.flatMap(entry =>
          entry.endpoint === null || providerKeys.has(McpCatalogModel.endpointKey(entry.endpoint)) ? [] : [{ ...entry, endpoint: entry.endpoint }],
        )
      : []
  const showCustom = trimmed === '' || 'custom mcp add your own'.includes(trimmed.toLocaleLowerCase())

  const add = async (input: { readonly name: string; readonly url: string; readonly oauth: boolean }): Promise<void> => {
    setPendingUrl(input.url)
    const added = await props.actions.addHosted(McpServerFormModel.catalogServerDraft({ ...input, taken: servers.map(server => server.serverName) }))
    setPendingUrl(null)
    if (added) props.onClose()
  }

  const addProvider = (provider: Provider): void => {
    if (provider.auth === 'token') {
      props.onCustom({
        values: McpServerFormModel.blankServerForm({
          name: provider.name,
          endpoint: provider.url,
          headerRefs: { Authorization: `${provider.id.toUpperCase().replace(/-/g, '_')}_MCP_AUTHORIZATION` },
        }),
        hint: t('tokenHint'),
      })
      return
    }
    void add({ name: provider.name, url: provider.url, oauth: provider.auth === 'oauth' })
  }

  const addButton = (url: string, onClick: () => void): JSX.Element => {
    const already = registered.has(McpCatalogModel.endpointKey(url))
    return (
      <Button disabled={already || pendingUrl !== null || props.actions.isPending} onClick={onClick} size="sm">
        {already ? t('added') : pendingUrl === url ? t('adding') : t('addCatalog')}
      </Button>
    )
  }

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) props.onClose()
      }}
      open={props.open}
    >
      <DialogContent
        className="dshx-root dshx:flex dshx:max-h-[min(80vh,40rem)] dshx:flex-col dshx:gap-0 dshx:overflow-hidden dshx:p-0 dshx:sm:max-w-5xl"
        showCloseButton={false}
      >
        <header className="dshx:flex dshx:shrink-0 dshx:flex-wrap dshx:items-center dshx:gap-3 dshx:border-b dshx:px-4 dshx:py-3">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-[1_1_20rem] dshx:items-baseline dshx:gap-3">
            <DialogTitle className="dshx:shrink-0 dshx:text-base">{t('browseTitle')}</DialogTitle>
            <DialogDescription className="dshx:truncate">{t('browseSubtitle')}</DialogDescription>
          </div>
          <InputGroup className="dshx:h-9 dshx:w-64 dshx:shrink-0 dshx:bg-muted/50">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={t('search')}
              autoFocus
              maxLength={80}
              onChange={event => setSearch(event.currentTarget.value)}
              placeholder={t('search')}
              value={search}
            />
          </InputGroup>
          <Button aria-label={t('close')} onClick={props.onClose} size="icon-sm" variant="ghost">
            <XIcon />
          </Button>
        </header>
        <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto dshx:p-3">
          {props.actions.failed || registry.isError ? (
            <Alert className="dshx:mb-3" variant="destructive">
              <AlertDescription>{t('error')}</AlertDescription>
            </Alert>
          ) : null}
          <SignInNotice actions={props.actions} className="dshx:mb-3" t={t} />
          <div className="dshx:grid dshx:gap-2 dshx:sm:grid-cols-2 dshx:xl:grid-cols-3">
            {showCustom ? (
              <button
                className="dshx:flex dshx:min-h-24 dshx:items-center dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-2.5 dshx:text-left dshx:transition-colors dshx:outline-none dshx:hover:bg-accent/50 dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50"
                onClick={() => props.onCustom({ values: McpServerFormModel.blankServerForm(), hint: undefined })}
                type="button"
              >
                <span className="dshx:flex dshx:size-9 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:bg-muted">
                  <PlusIcon className="dshx:size-5" />
                </span>
                <span className="dshx:flex dshx:min-w-0 dshx:flex-col">
                  <span className="dshx:text-sm dshx:font-medium">{t('custom')}</span>
                  <span className="dshx:mt-0.5 dshx:text-xs dshx:text-muted-foreground">{t('customDescription')}</span>
                </span>
              </button>
            ) : null}
            {providers.map(provider => (
              <CatalogCard
                action={addButton(provider.url, () => addProvider(provider))}
                badge={provider.category}
                description={provider.description}
                footer={
                  <a
                    className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground dshx:underline dshx:underline-offset-4 dshx:hover:text-foreground"
                    href={provider.docsUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {t('docs')}
                  </a>
                }
                key={provider.id}
                mark={<ProviderMark id={provider.id} />}
                title={provider.name}
              />
            ))}
            {registryRows.map(entry => (
              <CatalogCard
                action={addButton(entry.endpoint, () => void add({ name: entry.title || entry.name, url: entry.endpoint, oauth: false }))}
                badge={t('registryBadge')}
                description={entry.description || entry.version}
                footer={
                  <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground" title={entry.name}>
                    {new URL(entry.endpoint).host}
                  </span>
                }
                key={`${entry.name}-${entry.version}`}
                mark={<ProviderMark id="registry" />}
                title={entry.title || entry.name}
              />
            ))}
            {registry.isFetching ? (
              <p
                className="dshx:col-span-full dshx:flex dshx:items-center dshx:justify-center dshx:gap-2 dshx:py-4 dshx:text-xs dshx:text-muted-foreground"
                role="status"
              >
                <Spinner /> {t('registrySearching')}
              </p>
            ) : null}
            {!registryEnabled && trimmed.length >= 2 ? (
              <p className="dshx:col-span-full dshx:py-4 dshx:text-center dshx:text-xs dshx:text-muted-foreground">{t('registryOff')}</p>
            ) : null}
            {registryEnabled && trimmed.length === 1 && providers.length === 0 ? (
              <p className="dshx:col-span-full dshx:py-4 dshx:text-center dshx:text-xs dshx:text-muted-foreground">{t('registryTypeMore')}</p>
            ) : null}
            {registryEnabled &&
            trimmed.length >= 2 &&
            providers.length === 0 &&
            registryRows.length === 0 &&
            !registry.isFetching &&
            registryQuery === trimmed ? (
              <p className="dshx:col-span-full dshx:py-4 dshx:text-center dshx:text-xs dshx:text-muted-foreground">{t('registryNoMatch')}</p>
            ) : null}
          </div>
          <footer className="dshx:mt-3 dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2 dshx:border-t dshx:pt-3 dshx:text-[11px] dshx:text-muted-foreground">
            <p>{t('registryDisclaimer')}</p>
            <a className="dshx:underline dshx:underline-offset-4 dshx:hover:text-foreground" href={REGISTRY_URL} rel="noopener noreferrer" target="_blank">
              {t('exploreRegistry')}
            </a>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
