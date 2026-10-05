import { Button, IconDownloadOutlineMedium, IconLoadingOutlineMedium, Modal, Pill, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useApi, type PropsLocaleOf } from '@dshfiles/dshx/client'
import { EmptyState, Notice } from '@dshfiles/plugin-ui'
import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@dshfiles/plugin-ui/query'
import { useMemo, useState, type ReactNode } from 'react'
import type { InstallFailureCode, MarketplaceCard, MarketplaceListOutput, MarketplaceLocale } from './api.js'
import { pluginMarketplaceApi } from './api.js'
import { marketplaceLocale, type MarketplaceLocaleKey } from './locales.js'
import styles from './MarketplaceTab.module.css'

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
      <span className={styles.glyph} aria-hidden="true">
        {plugin.glyph}
      </span>
    )
  }
  return (
    <span className={styles.icon} aria-hidden="true">
      <img
        src={plugin.iconUrl}
        alt=""
        onError={() => {
          setFailed(true)
        }}
      />
    </span>
  )
}

const InstallSpinner = (): ReactNode => <IconLoadingOutlineMedium className={styles.spinner} />

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

  const footer =
    confirm || risk ? (
      <>
        <Button variant="outline" disabled={installing} onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={installing}
          icon={installing ? <InstallSpinner /> : risk ? <IconDownloadOutlineMedium /> : undefined}
          data-modal-autofocus
          onClick={() => {
            if (confirm) onContinue(state.plugin)
            else onInstall(state.plugin)
          }}
        >
          {installing ? t('downloading') : risk ? t('finalConfirmInstall') : t('continueInstall')}
        </Button>
      </>
    ) : state.kind === 'failure' ? (
      <>
        <Button variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          data-modal-autofocus
          onClick={() => {
            onRetry(state.plugin)
          }}
        >
          {t('retryInstall')}
        </Button>
      </>
    ) : (
      <Button variant="primary" data-modal-autofocus onClick={onClose}>
        {t('close')}
      </Button>
    )

  return (
    <Modal
      open
      title={t(MODAL_TITLE[state.kind])}
      description={state.plugin.name}
      closeLabel={t('closeDialog')}
      footer={footer}
      onClose={() => {
        if (!installing) onClose()
      }}
    >
      <div className={styles.dialogBody}>
        {confirm ? (
          <>
            <p className={styles.dialogMessage}>{t('installToProfile')}</p>
            <dl className={styles.installFacts}>
              <div>
                <dt>{t('packageLabel')}</dt>
                <dd>
                  <code>{state.plugin.packageName}</code>
                </dd>
              </div>
              <div>
                <dt>{t('versionLabel')}</dt>
                <dd>{state.plugin.version}</dd>
              </div>
              <div>
                <dt>{t('sourceLabel')}</dt>
                <dd>{t(state.plugin.badge)}</dd>
              </div>
            </dl>
          </>
        ) : null}
        {confirm || risk ? <Notice tone="warning">{t('riskWarning')}</Notice> : null}
        {state.kind === 'success' ? <Notice tone="success">{t('installSuccess')}</Notice> : null}
        {state.kind === 'failure' ? <Notice tone="danger">{t(FAILURE_COPY[state.code])}</Notice> : null}
      </div>
    </Modal>
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
    <li className={styles.card}>
      <div className={styles.cardHeader}>
        <PluginIcon plugin={plugin} />
        <div className={styles.identity}>
          <div className={styles.titleLine}>
            <h3>{plugin.name}</h3>
            <Tag tone={plugin.badge === 'official' ? 'info' : 'neutral'}>{t(plugin.badge)}</Tag>
          </div>
          <p className={styles.description}>{plugin.description}</p>
        </div>
      </div>
      <div className={styles.cardFooter}>
        <div className={styles.metadata}>
          <code title={plugin.packageName}>{plugin.packageName}</code>
          <span aria-label={`${t('versionLabel')} ${plugin.version}`}>v{plugin.version}</span>
        </div>
        <Button
          variant={plugin.installed ? 'outline' : 'primary'}
          size="sm"
          icon={installing ? <InstallSpinner /> : plugin.installed ? undefined : <IconDownloadOutlineMedium />}
          disabled={plugin.installed || installBusy}
          aria-label={accessibleLabel}
          onClick={onDownload}
        >
          {label}
        </Button>
      </div>
    </li>
  )
}

/** Settings tab for browsing and installing Framework Hub plugins. */
export const MarketplaceTab = ({ t }: MarketplaceTabProps): ReactNode => {
  const api = useApi(pluginMarketplaceApi)
  const queryClient = useQueryClient()
  const locale = currentLocale()
  const [category, setCategory] = useState<string | undefined>()
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
  const installingSlug = install.isPending ? (install.variables?.slug ?? null) : null

  return (
    <section className={styles.section} aria-busy={initialLoading || catalog.isFetchingNextPage}>
      <nav className={styles.categories} aria-label={t('categoriesLabel')}>
        <Pill
          active={category === undefined}
          aria-pressed={category === undefined}
          onClick={() => {
            setCategory(undefined)
          }}
        >
          {t('all')}
        </Pill>
        {categories.map(item => (
          <Pill
            key={item.slug}
            active={category === item.slug}
            aria-pressed={category === item.slug}
            onClick={() => {
              setCategory(item.slug)
            }}
          >
            {item.name}
          </Pill>
        ))}
      </nav>

      {initialLoading ? <Notice>{t('loading')}</Notice> : null}
      {listFailed && !initialLoading ? (
        <Notice
          tone="danger"
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void catalog.refetch()
              }}
            >
              {t('retry')}
            </Button>
          }
        >
          {t('unavailable')}
        </Notice>
      ) : null}
      {!initialLoading && catalog.isSuccess && items.length === 0 ? <EmptyState description={t('empty')} compact /> : null}

      {items.length > 0 ? (
        <ul className={styles.cards} aria-label={t('pluginsLabel')}>
          {items.map(plugin => (
            <PluginCard
              key={plugin.slug}
              plugin={plugin}
              installing={installingSlug === plugin.slug}
              installBusy={installingSlug !== null}
              failed={failedSlugs.has(plugin.slug)}
              t={t}
              onDownload={() => {
                setModal({ kind: 'confirm', plugin })
              }}
            />
          ))}
        </ul>
      ) : null}

      {catalog.hasNextPage && !showingPreviousCategory ? (
        <div className={styles.loadMoreRow}>
          {catalog.isFetchNextPageError ? <Notice tone="danger">{t('unavailable')}</Notice> : null}
          <Button
            variant="outline"
            size="sm"
            disabled={catalog.isFetchingNextPage}
            onClick={() => {
              void catalog.fetchNextPage()
            }}
          >
            {catalog.isFetchingNextPage ? t('loadingMore') : catalog.isFetchNextPageError ? t('retry') : t('loadMore')}
          </Button>
        </div>
      ) : null}

      {modal !== null ? (
        <InstallDialog
          state={modal}
          installing={installingSlug === modal.plugin.slug}
          t={t}
          onClose={() => {
            if (installingSlug === null) setModal(null)
          }}
          onContinue={plugin => {
            setModal({ kind: 'risk', plugin })
          }}
          onRetry={plugin => {
            setModal({ kind: 'confirm', plugin })
          }}
          onInstall={plugin => {
            if (installingSlug === null) install.mutate(plugin)
          }}
        />
      ) : null}
    </section>
  )
}
