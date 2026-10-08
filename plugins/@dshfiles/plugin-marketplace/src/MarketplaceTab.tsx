import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useApi, type PropsLocaleOf } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@dshfiles/plugin-ui/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Skeleton } from '@dshfiles/plugin-ui/components/ui/skeleton'
import { Toggle } from '@dshfiles/plugin-ui/components/ui/toggle'
import { CheckIcon, CircleCheckIcon, DownloadIcon, Loader2Icon, PackageSearchIcon, SearchIcon, TriangleAlertIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@dshfiles/plugin-ui/query'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { InstallFailureCode, MarketplaceCard, MarketplaceListOutput, MarketplaceLocale } from './api.js'
import { pluginMarketplaceApi } from './api.js'
import { marketplaceLocale, type MarketplaceLocaleKey } from './locales.js'

export type MarketplaceTabProps = PropsRuntime<'settings.plugins.tab'> & PropsLocaleOf<typeof marketplaceLocale>

type Translate = MarketplaceTabProps['t']
type ModalState =
  | { readonly kind: 'confirm'; readonly plugin: MarketplaceCard }
  | { readonly kind: 'risk'; readonly plugin: MarketplaceCard }
  | { readonly kind: 'success'; readonly plugin: MarketplaceCard }
  | {
      readonly kind: 'failure'
      readonly plugin: MarketplaceCard
      readonly code: InstallFailureCode
    }

const CATALOG_QUERY_KEY = ['plugin-marketplace', 'list'] as const

const FAILURE_COPY = {
  busy: 'busy',
  'catalog-unavailable': 'catalogUnavailable',
  'target-unavailable': 'targetUnavailable',
  'profile-unavailable': 'profileUnavailable',
  'compatibility-unknown': 'installCompatibilityUnknown',
  incompatible: 'installIncompatible',
  'install-failed': 'installFailed',
  'activation-missing': 'activationMissing',
  cancelled: 'cancelled',
  timeout: 'timeout',
} as const satisfies Record<InstallFailureCode, MarketplaceLocaleKey>

const MODAL_TITLE = {
  confirm: 'installTitle',
  risk: 'riskTitle',
  success: 'installSuccessTitle',
  failure: 'installFailedTitle',
} as const satisfies Record<ModalState['kind'], MarketplaceLocaleKey>

const currentLocale = (): MarketplaceLocale => {
  if (typeof document === 'undefined') return 'en'
  return document.documentElement.lang.toLocaleLowerCase().startsWith('zh') ? 'zh' : 'en'
}

const interpolate = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{([^}]+)\}/g, (_match, key: string) => values[key] ?? '')

const uniqueCards = (pages: readonly MarketplaceListOutput[]): readonly MarketplaceCard[] => {
  const bySlug = new Map<string, MarketplaceCard>()
  for (const page of pages) for (const card of page.items) if (!bySlug.has(card.slug)) bySlug.set(card.slug, card)
  return [...bySlug.values()]
}

const matchesSearch = (plugin: MarketplaceCard, query: string): boolean =>
  `${plugin.name} ${plugin.description} ${plugin.packageName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())

const markInstalled = (catalog: InfiniteData<MarketplaceListOutput> | undefined, slug: string): InfiniteData<MarketplaceListOutput> | undefined =>
  catalog === undefined
    ? undefined
    : {
        ...catalog,
        pages: catalog.pages.map(page => ({ ...page, items: page.items.map(item => (item.slug === slug ? { ...item, installed: true } : item)) })),
      }

const PluginIcon = ({ plugin }: { readonly plugin: MarketplaceCard }): ReactNode => {
  const [failed, setFailed] = useState(false)
  if (plugin.iconUrl === null || failed) {
    return (
      <span
        aria-hidden="true"
        className="dshx:flex dshx:size-10 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:border dshx:bg-muted dshx:text-sm dshx:font-semibold dshx:text-muted-foreground"
      >
        {plugin.glyph}
      </span>
    )
  }
  return (
    <span aria-hidden="true" className="dshx:flex dshx:size-10 dshx:shrink-0 dshx:overflow-hidden dshx:rounded-md dshx:border dshx:bg-background">
      <img
        alt=""
        className="dshx:size-full dshx:object-contain"
        onError={() => {
          setFailed(true)
        }}
        src={plugin.iconUrl}
      />
    </span>
  )
}

const InstallSpinner = (): ReactNode => <Loader2Icon className="dshx:size-3.5 dshx:animate-spin" />

const InstallDialog = ({
  state,
  installing,
  t,
  onClose,
  onContinue,
  onRetry,
  onInstall,
}: {
  readonly state: ModalState
  readonly installing: boolean
  readonly t: Translate
  readonly onClose: () => void
  readonly onContinue: (plugin: MarketplaceCard) => void
  readonly onRetry: (plugin: MarketplaceCard) => void
  readonly onInstall: (plugin: MarketplaceCard) => void
}): ReactNode => {
  const confirm = state.kind === 'confirm'
  const risk = state.kind === 'risk'
  const primaryRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !installing) onClose()
      }}
    >
      <DialogContent
        className="dshx-root dshx:gap-4 dshx:p-5 dshx:sm:max-w-md"
        onOpenAutoFocus={event => {
          event.preventDefault()
          primaryRef.current?.focus()
        }}
        showCloseButton={false}
      >
        <DialogHeader className="dshx:gap-1 dshx:pr-8">
          <DialogTitle className="dshx:text-base">{t(MODAL_TITLE[state.kind])}</DialogTitle>
          <DialogDescription>{state.plugin.name}</DialogDescription>
        </DialogHeader>
        <Button
          aria-label={t('closeDialog')}
          className="dshx:absolute dshx:top-3 dshx:right-3"
          disabled={installing}
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
        <div className="dshx:flex dshx:flex-col dshx:gap-3">
          {confirm ? (
            <>
              <p className="dshx:text-sm">{t('installToProfile')}</p>
              <dl className="dshx:grid dshx:grid-cols-[auto_1fr] dshx:gap-x-4 dshx:gap-y-1.5 dshx:rounded-md dshx:border dshx:bg-muted/40 dshx:p-3 dshx:text-sm">
                <dt className="dshx:text-muted-foreground">{t('packageLabel')}</dt>
                <dd className="dshx:min-w-0 dshx:break-all">
                  <code className="dshx:font-mono dshx:text-xs">{state.plugin.packageName}</code>
                </dd>
                <dt className="dshx:text-muted-foreground">{t('versionLabel')}</dt>
                <dd>{state.plugin.version}</dd>
                <dt className="dshx:text-muted-foreground">{t('sourceLabel')}</dt>
                <dd>{t(state.plugin.badge)}</dd>
              </dl>
            </>
          ) : null}
          {confirm || risk ? (
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertDescription className="dshx:text-foreground">{t('riskWarning')}</AlertDescription>
            </Alert>
          ) : null}
          {state.kind === 'success' ? (
            <Alert variant="success">
              <CircleCheckIcon />
              <AlertDescription className="dshx:text-foreground">{t('installSuccess')}</AlertDescription>
            </Alert>
          ) : null}
          {state.kind === 'failure' ? (
            <Alert variant="destructive">
              <AlertDescription>{t(FAILURE_COPY[state.code])}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          {confirm || risk ? (
            <>
              <Button disabled={installing} onClick={onClose} size="sm" type="button" variant="outline">
                {t('cancel')}
              </Button>
              <Button
                disabled={installing}
                onClick={() => {
                  if (confirm) onContinue(state.plugin)
                  else onInstall(state.plugin)
                }}
                ref={primaryRef}
                size="sm"
                type="button"
              >
                {installing ? <InstallSpinner /> : risk ? <DownloadIcon /> : null}
                {installing ? t('downloading') : risk ? t('finalConfirmInstall') : t('continueInstall')}
              </Button>
            </>
          ) : state.kind === 'failure' ? (
            <>
              <Button onClick={onClose} size="sm" type="button" variant="outline">
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  onRetry(state.plugin)
                }}
                ref={primaryRef}
                size="sm"
                type="button"
              >
                {t('retryInstall')}
              </Button>
            </>
          ) : (
            <Button onClick={onClose} ref={primaryRef} size="sm" type="button">
              {t('close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const PluginCard = ({
  plugin,
  installing,
  installBusy,
  failed,
  t,
  onDownload,
}: {
  readonly plugin: MarketplaceCard
  readonly installing: boolean
  readonly installBusy: boolean
  readonly failed: boolean
  readonly t: Translate
  readonly onDownload: () => void
}): ReactNode => {
  const label = plugin.installed
    ? t('installed')
    : plugin.compatibility === 'unknown'
      ? `${t('download')} · ${t('compatibilityUnknown')}`
      : plugin.compatibility === 'incompatible'
        ? `${t('download')} · ${t('incompatible')}`
        : installing
          ? t('downloading')
          : failed
            ? t('retry')
            : t('download')
  const accessibleLabel = plugin.installed ? `${plugin.name}: ${label}` : interpolate(t(failed ? 'retryPlugin' : 'downloadPlugin'), { name: plugin.name })

  return (
    <li className="dshx:flex dshx:min-w-0 dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-3 dshx:text-card-foreground">
      <PluginIcon plugin={plugin} />
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
          <h3 className="dshx:truncate dshx:text-sm dshx:font-semibold">{plugin.name}</h3>
          <Badge variant={plugin.badge === 'official' ? 'info' : 'muted'}>{t(plugin.badge)}</Badge>
        </div>
        <p className="dshx:line-clamp-2 dshx:text-sm dshx:text-muted-foreground">{plugin.description}</p>
        <div className="dshx:mt-auto dshx:flex dshx:items-end dshx:justify-between dshx:gap-3 dshx:pt-2">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:text-xs dshx:text-muted-foreground">
            <code className="dshx:truncate dshx:font-mono" title={plugin.packageName}>
              {plugin.packageName}
            </code>
            <span aria-label={`${t('versionLabel')} ${plugin.version}`}>v{plugin.version}</span>
          </div>
          <Button
            aria-label={accessibleLabel}
            className="dshx:shrink-0"
            disabled={plugin.installed || installBusy}
            onClick={onDownload}
            size="sm"
            type="button"
            variant={plugin.installed ? 'outline' : 'default'}
          >
            {installing ? (
              <InstallSpinner />
            ) : plugin.installed ? (
              <CheckIcon />
            ) : (
              <DownloadIcon />
            )}
            {label}
          </Button>
        </div>
      </div>
    </li>
  )
}

const CardSkeleton = (): ReactNode => (
  <div className="dshx:flex dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-3">
    <Skeleton className="dshx:size-10 dshx:shrink-0" />
    <div className="dshx:flex dshx:flex-1 dshx:flex-col dshx:gap-2">
      <Skeleton className="dshx:h-4 dshx:w-1/2" />
      <Skeleton className="dshx:h-3 dshx:w-full" />
      <Skeleton className="dshx:h-3 dshx:w-3/4" />
      <div className="dshx:flex dshx:justify-between dshx:pt-1">
        <Skeleton className="dshx:h-3 dshx:w-1/3" />
        <Skeleton className="dshx:h-7 dshx:w-20" />
      </div>
    </div>
  </div>
)

/** Settings tab for browsing and installing Framework Hub plugins. */
export const MarketplaceTab = ({ t }: MarketplaceTabProps): ReactNode => {
  const api = useApi(pluginMarketplaceApi)
  const queryClient = useQueryClient()
  const locale = currentLocale()
  const [category, setCategory] = useState<string | undefined>()
  const [search, setSearch] = useState('')
  const [failedSlugs, setFailedSlugs] = useState<ReadonlySet<string>>(() => new Set())
  const [modal, setModal] = useState<ModalState | null>(null)
  const catalog = useInfiniteQuery({
    queryKey: [...CATALOG_QUERY_KEY, locale, category ?? null],
    queryFn: ({ pageParam, signal }) => api.list({ locale, category, cursor: pageParam ?? undefined }, { signal }),
    initialPageParam: null,
    getNextPageParam: (lastPage: MarketplaceListOutput): string | null => lastPage.nextCursor,
    placeholderData: keepPreviousData,
  })

  const install = useMutation({
    mutationFn: (plugin: MarketplaceCard) => api.install({ slug: plugin.slug }),
    onSuccess: (result, plugin) => {
      if (result.status === 'failed') {
        setFailedSlugs(current => new Set([...current, plugin.slug]))
        setModal({ kind: 'failure', plugin, code: result.code })
        return
      }
      setFailedSlugs(current => new Set([...current].filter(slug => slug !== plugin.slug)))
      queryClient.setQueriesData<InfiniteData<MarketplaceListOutput>>({ queryKey: CATALOG_QUERY_KEY }, data => markInstalled(data, plugin.slug))
      setModal({ kind: 'success', plugin: { ...plugin, installed: true } })
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY })
    },
    onError: (_error, plugin) => {
      setFailedSlugs(current => new Set([...current, plugin.slug]))
      setModal({ kind: 'failure', plugin, code: 'install-failed' })
    },
  })

  const showingPreviousCategory = catalog.isPlaceholderData
  const items = useMemo(() => (showingPreviousCategory ? [] : uniqueCards(catalog.data?.pages ?? [])), [catalog.data, showingPreviousCategory])
  const categories = catalog.data?.pages[0]?.categories ?? []
  const initialLoading = catalog.isPending || (catalog.isFetching && items.length === 0)
  const listFailed = catalog.isError && !catalog.isFetchNextPageError && items.length === 0
  const trimmedSearch = search.trim()
  const visibleItems = useMemo(() => (trimmedSearch.length === 0 ? items : items.filter(item => matchesSearch(item, trimmedSearch))), [items, trimmedSearch])
  const installingSlug = install.isPending ? (install.variables?.slug ?? null) : null

  return (
    <section aria-busy={initialLoading || catalog.isFetchingNextPage} className="dshx-root dshx:@container dshx:flex dshx:flex-col dshx:gap-4">
      <div className="dshx:flex dshx:flex-col dshx:gap-3">
        <InputGroup className="dshx:@2xl:max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={t('searchLabel')}
            autoComplete="off"
            onChange={event => {
              setSearch(event.currentTarget.value)
            }}
            placeholder={t('searchPlaceholder')}
            type="search"
            value={search}
          />
          {search.length > 0 ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={t('clearSearch')}
                onClick={() => {
                  setSearch('')
                }}
                size="icon-xs"
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <nav aria-label={t('categoriesLabel')} className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
          <Toggle
            onPressedChange={() => {
              setCategory(undefined)
            }}
            pressed={category === undefined}
            size="sm"
            variant="outline"
            className="dshx:px-2.5 dshx:text-xs"
          >
            {t('all')}
          </Toggle>
          {categories.map(item => (
            <Toggle
              className="dshx:px-2.5 dshx:text-xs"
              key={item.slug}
              onPressedChange={() => {
                setCategory(item.slug)
              }}
              pressed={category === item.slug}
              size="sm"
              variant="outline"
            >
              {item.name}
            </Toggle>
          ))}
        </nav>
      </div>

      {initialLoading ? (
        <div aria-label={t('loading')} className="dshx:grid dshx:grid-cols-1 dshx:gap-3 dshx:@xl:grid-cols-2 dshx:@5xl:grid-cols-3" role="status">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : null}
      {listFailed && !initialLoading ? (
        <Alert className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3" variant="destructive">
          <AlertDescription>{t('unavailable')}</AlertDescription>
          <Button
            className="dshx:shrink-0"
            onClick={() => {
              void catalog.refetch()
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {t('retry')}
          </Button>
        </Alert>
      ) : null}
      {!initialLoading && catalog.isSuccess && (items.length === 0 || visibleItems.length === 0) ? (
        <Empty className="dshx:border dshx:p-6 dshx:md:p-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageSearchIcon />
            </EmptyMedia>
            <EmptyDescription>{items.length === 0 ? t('empty') : t('noSearchMatches')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {visibleItems.length > 0 ? (
        <ul aria-label={t('pluginsLabel')} className="dshx:grid dshx:grid-cols-1 dshx:gap-3 dshx:@xl:grid-cols-2 dshx:@5xl:grid-cols-3">
          {visibleItems.map(plugin => (
            <PluginCard
              failed={failedSlugs.has(plugin.slug)}
              installBusy={installingSlug !== null}
              installing={installingSlug === plugin.slug}
              key={plugin.slug}
              onDownload={() => {
                setModal({ kind: 'confirm', plugin })
              }}
              plugin={plugin}
              t={t}
            />
          ))}
        </ul>
      ) : null}

      {catalog.hasNextPage && !showingPreviousCategory ? (
        <div className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-2">
          {catalog.isFetchNextPageError ? (
            <Alert variant="destructive">
              <AlertDescription>{t('unavailable')}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            disabled={catalog.isFetchingNextPage}
            onClick={() => {
              void catalog.fetchNextPage()
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {catalog.isFetchingNextPage ? <InstallSpinner /> : null}
            {catalog.isFetchingNextPage ? t('loadingMore') : catalog.isFetchNextPageError ? t('retry') : t('loadMore')}
          </Button>
        </div>
      ) : null}

      {modal !== null ? (
        <InstallDialog
          installing={installingSlug === modal.plugin.slug}
          onClose={() => {
            if (installingSlug === null) setModal(null)
          }}
          onContinue={plugin => {
            setModal({ kind: 'risk', plugin })
          }}
          onInstall={plugin => {
            if (installingSlug === null) install.mutate(plugin)
          }}
          onRetry={plugin => {
            setModal({ kind: 'confirm', plugin })
          }}
          state={modal}
          t={t}
        />
      ) : null}
    </section>
  )
}
