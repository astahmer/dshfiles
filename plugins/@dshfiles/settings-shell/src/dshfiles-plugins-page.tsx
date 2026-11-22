import { useApi } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Skeleton } from '@dshfiles/plugin-ui/components/ui/skeleton'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { LockIcon, PuzzleIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, PluginQueryProvider, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useMemo, useState } from 'react'
import type { ShellTranslate } from './native/locales.js'
import { SettingsGroups, type GroupedEntries } from './settings-groups.js'
import { settingsShellApi, type PluginBundle, type PluginBundleChange, type PluginBundleOrigin } from './shell-api.js'

export const BUNDLES_QUERY_KEY = ['settings-shell', 'bundles'] as const
const PLUGINS_QUERY_KEY = ['settings-shell', 'plugins'] as const

export type BundleScopeFilter = 'dshfiles' | 'community' | 'all'
export type BundleStatusFilter = 'all' | 'enabled' | 'disabled'

export type BundleCategoryId = 'workspace' | 'models' | 'agents' | 'tools' | 'projects' | 'hosts' | 'security' | 'diagnostics' | 'core'

const BUNDLE_CATEGORIES = [
  { id: 'workspace', labelKey: 'pluginsPage.cat.workspace' },
  { id: 'models', labelKey: 'pluginsPage.cat.models' },
  { id: 'agents', labelKey: 'pluginsPage.cat.agents' },
  { id: 'tools', labelKey: 'pluginsPage.cat.tools' },
  { id: 'projects', labelKey: 'pluginsPage.cat.projects' },
  { id: 'hosts', labelKey: 'pluginsPage.cat.hosts' },
  { id: 'security', labelKey: 'pluginsPage.cat.security' },
  { id: 'diagnostics', labelKey: 'pluginsPage.cat.diagnostics' },
  { id: 'core', labelKey: 'pluginsPage.cat.core' },
] as const satisfies ReadonlyArray<{ readonly id: BundleCategoryId; readonly labelKey: Parameters<ShellTranslate>[0] }>

const DSHFILES_CATEGORY = new Map<string, BundleCategoryId>([
  ['ui-styles', 'workspace'],
  ['frame-layout', 'workspace'],
  ['main-tabs', 'workspace'],
  ['workbench', 'workspace'],
  ['thread-sidebar', 'workspace'],
  ['sidebar-right', 'workspace'],
  ['sidebar-terminal', 'workspace'],
  ['command-palette', 'workspace'],
  ['rich-composer', 'workspace'],
  ['chat', 'workspace'],
  ['queue-reorder', 'workspace'],
  ['turn-summary', 'workspace'],
  ['tool-meta', 'workspace'],
  ['annotations', 'workspace'],
  ['editor', 'workspace'],
  ['shortcuts', 'workspace'],
  ['settings-shell', 'workspace'],
  ['dialogs', 'workspace'],
  ['onboarding', 'workspace'],
  ['pwa', 'workspace'],
  ['attachment-gallery', 'workspace'],
  ['html-render', 'workspace'],
  ['mermaid-diagrams', 'workspace'],
  ['cordis-cards', 'workspace'],
  ['whiteboard', 'workspace'],
  ['component-gallery', 'workspace'],
  ['ai-accounts', 'models'],
  ['model-selection', 'models'],
  ['model-effort-picker', 'models'],
  ['settings-models', 'models'],
  ['usage', 'models'],
  ['agent-loop', 'agents'],
  ['agent-preset', 'agents'],
  ['agent-plan', 'agents'],
  ['agent-communication', 'agents'],
  ['agent-questions', 'agents'],
  ['agent-toolkit', 'agents'],
  ['agents', 'agents'],
  ['agentsview', 'agents'],
  ['context-compaction', 'agents'],
  ['goal-stall-guard', 'agents'],
  ['goal-tool', 'agents'],
  ['memory', 'agents'],
  ['worktree-memory', 'agents'],
  ['tool-subagent', 'agents'],
  ['settings-subagent', 'agents'],
  ['btw', 'agents'],
  ['prompt-stash', 'agents'],
  ['schedule', 'agents'],
  ['mcp-servers', 'tools'],
  ['mcp-endpoint', 'tools'],
  ['web-search-brave', 'tools'],
  ['settings-web-search', 'tools'],
  ['web-fetch-readable', 'tools'],
  ['apply-patch', 'tools'],
  ['fff-search', 'tools'],
  ['tool-search', 'tools'],
  ['tool-ask-user', 'tools'],
  ['user-questions', 'tools'],
  ['input-trigger', 'tools'],
  ['mentions', 'tools'],
  ['references', 'tools'],
  ['tweet-context', 'tools'],
  ['deliverables', 'tools'],
  ['capabilities-hub', 'tools'],
  ['plugin-guide', 'tools'],
  ['backlog', 'projects'],
  ['backlog-notion', 'projects'],
  ['backlog-jira', 'projects'],
  ['jj-integration', 'projects'],
  ['jujutsu', 'projects'],
  ['git-worktrees', 'projects'],
  ['workspace-folder-picker', 'projects'],
  ['workspace-nav', 'projects'],
  ['diff-viewed', 'projects'],
  ['diffs-review', 'projects'],
  ['project-checks', 'projects'],
  ['project-automations', 'projects'],
  ['test-runs', 'projects'],
  ['preview', 'projects'],
  ['session-undo', 'projects'],
  ['thread-transfer', 'projects'],
  ['multi-host', 'hosts'],
  ['phone-access', 'hosts'],
  ['phone-pairing', 'hosts'],
  ['loopback-access', 'hosts'],
  ['secret-catalog', 'security'],
  ['policies', 'security'],
  ['agent-telemetry', 'diagnostics'],
  ['traces', 'diagnostics'],
  ['activity-timeline', 'diagnostics'],
  ['background-jobs', 'diagnostics'],
  ['hmr-gate', 'diagnostics'],
  ['request-messages', 'diagnostics'],
  ['session-search', 'diagnostics'],
  ['shared-runtime', 'core'],
  ['shared-streams', 'core'],
  ['session-controller', 'core'],
  ['session-persistence-jsonl', 'core'],
  ['storage-domain', 'core'],
  ['storage-json', 'core'],
  ['subprocess-local', 'core'],
  ['cordis-client-runner', 'core'],
])

export const bundleCategoryOf = (bundle: Pick<PluginBundle, 'name' | 'origin'>): BundleCategoryId => {
  if (bundle.origin === 'dshfiles') {
    const short = bundle.name.slice('@dshfiles/'.length)
    return DSHFILES_CATEGORY.get(short) ?? 'tools'
  }
  if (bundle.origin === 'dsh') return 'core'
  return 'tools'
}

export const resolveBundleText = (value: PluginBundle['title'], resolveLocaleText: (text: NonNullable<PluginBundle['title']>) => string): string =>
  value === null ? '' : resolveLocaleText(value)

export const bundleDisplayTitle = (
  bundle: Pick<PluginBundle, 'name' | 'title'>,
  resolveLocaleText: (text: NonNullable<PluginBundle['title']>) => string,
): string => {
  const resolved = resolveBundleText(bundle.title, resolveLocaleText).trim()
  if (resolved !== '' && resolved !== bundle.name) return resolved
  return SettingsGroups.humanizeId(bundle.name)
}

export const bundleDisplayDescription = (
  bundle: Pick<PluginBundle, 'description' | 'packageDescription'>,
  resolveLocaleText: (text: NonNullable<PluginBundle['description']>) => string,
): string => resolveBundleText(bundle.description, resolveLocaleText).trim() || (bundle.packageDescription ?? '').trim()

export const settingsEntryIdForBundle = (groups: readonly GroupedEntries[], bundle: Pick<PluginBundle, 'name' | 'rowIds'>): string | undefined => {
  const rowSet = new Set(bundle.rowIds)
  for (const group of groups) {
    for (const entry of group.entries) {
      if (entry.id === 'dshfiles-plugins') continue
      if (entry.bundleName === bundle.name) return entry.id
      if (entry.sectionId !== undefined && rowSet.has(entry.sectionId)) return entry.id
      if (entry.pages.some(page => rowSet.has(page.ns)) || entry.hiddenPages.some(page => rowSet.has(page.ns))) return entry.id
    }
  }
  return undefined
}

const matchesScope = (origin: PluginBundleOrigin, scope: BundleScopeFilter): boolean => {
  if (scope === 'all') return true
  return origin === scope
}

const changeVerdict = (change: PluginBundleChange, t: ShellTranslate): string | undefined => {
  if (change.application === 'overridden') return t('entryCard.overridden')
  if (change.application === 'failed') return t('entryCard.failed', { reason: change.error ?? '' })
  return undefined
}

export interface DshfilesPluginsViewProps {
  readonly bundles: readonly PluginBundle[]
  readonly loading: boolean
  readonly error: string | undefined
  readonly groups: readonly GroupedEntries[]
  readonly resolveLocaleText: (text: NonNullable<PluginBundle['title']>) => string
  readonly t: ShellTranslate
  readonly onRefresh: () => void
  readonly refreshing: boolean
  readonly onToggle: (name: string, enabled: boolean) => Promise<PluginBundleChange>
  readonly onOpenSettings: (entryId: string) => void
}

export const DshfilesPluginsView = (props: DshfilesPluginsViewProps): JSX.Element => {
  const { t } = props
  const [scope, setScope] = useState<BundleScopeFilter>('dshfiles')
  const [status, setStatus] = useState<BundleStatusFilter>('all')
  const [query, setQuery] = useState('')
  const [pendingNames, setPendingNames] = useState<ReadonlySet<string>>(() => new Set())
  const [rowMessages, setRowMessages] = useState<ReadonlyMap<string, string>>(() => new Map())

  const scopeCounts = useMemo(() => {
    let dshfiles = 0
    let community = 0
    for (const bundle of props.bundles) {
      if (bundle.origin === 'dshfiles') dshfiles += 1
      else if (bundle.origin === 'community') community += 1
    }
    return { dshfiles, community, all: props.bundles.length }
  }, [props.bundles])

  const effectiveScope: BundleScopeFilter = scope === 'dshfiles' && scopeCounts.dshfiles === 0 && scopeCounts.all > 0 ? 'all' : scope

  const scopedBundles = useMemo(() => props.bundles.filter(bundle => matchesScope(bundle.origin, effectiveScope)), [props.bundles, effectiveScope])

  const enabledCount = useMemo(() => scopedBundles.filter(bundle => bundle.enabled).length, [scopedBundles])
  const pendingRestartCount = useMemo(() => scopedBundles.filter(bundle => bundle.pendingRestart !== null).length, [scopedBundles])

  const filteredBundles = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scopedBundles.filter(bundle => {
      if (status === 'enabled' && !bundle.enabled) return false
      if (status === 'disabled' && bundle.enabled) return false
      if (needle === '') return true
      const title = bundleDisplayTitle(bundle, props.resolveLocaleText).toLowerCase()
      const description = bundleDisplayDescription(bundle, props.resolveLocaleText).toLowerCase()
      return `${title} ${bundle.name.toLowerCase()} ${description}`.includes(needle)
    })
  }, [scopedBundles, status, query, props.resolveLocaleText])

  const grouped = useMemo(() => {
    const buckets = new Map<BundleCategoryId, PluginBundle[]>()
    for (const bundle of filteredBundles) {
      const category = bundleCategoryOf(bundle)
      const list = buckets.get(category) ?? []
      list.push(bundle)
      buckets.set(category, list)
    }
    return BUNDLE_CATEGORIES.flatMap(category => {
      const items = buckets.get(category.id)
      if (items === undefined || items.length === 0) return []
      return [
        {
          id: category.id,
          label: t(category.labelKey),
          items: items.toSorted((left, right) =>
            bundleDisplayTitle(left, props.resolveLocaleText).localeCompare(bundleDisplayTitle(right, props.resolveLocaleText)),
          ),
        },
      ]
    })
  }, [filteredBundles, props.resolveLocaleText, t])

  const toggle = async (bundle: PluginBundle, enabled: boolean): Promise<void> => {
    setPendingNames(current => new Set(current).add(bundle.name))
    setRowMessages(current => {
      const next = new Map(current)
      next.delete(bundle.name)
      return next
    })
    try {
      const result = await props.onToggle(bundle.name, enabled)
      const verdict = changeVerdict(result, t)
      if (verdict !== undefined) {
        setRowMessages(current => new Map(current).set(bundle.name, verdict))
      }
    } catch (caught) {
      setRowMessages(current => new Map(current).set(bundle.name, errorMessage(caught, t('entryCard.failed', { reason: '' }))))
    } finally {
      setPendingNames(current => {
        const next = new Set(current)
        next.delete(bundle.name)
        return next
      })
    }
  }

  return (
    <div className="dshx:@container dshx:flex dshx:flex-col dshx:gap-4" data-dshfiles-plugins-page="">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:px-4 dshx:py-3">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <span className="dshx:text-sm dshx:font-medium dshx:text-foreground">
              {t('pluginsPage.summary', { enabled: enabledCount, total: scopedBundles.length })}
            </span>
            {pendingRestartCount > 0 && (
              <Badge data-plugins-pending-restart="" variant="warning">
                {t('pluginsPage.pendingRestart', { count: pendingRestartCount })}
              </Badge>
            )}
          </div>
          <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">{t('pluginsPage.subtitle')}</p>
        </div>
        <Button disabled={props.refreshing} onClick={props.onRefresh} size="sm" variant="outline">
          <RefreshCwIcon aria-hidden="true" className={cn('dshx:size-3.5', props.refreshing && 'dshx:animate-spin')} />
          {t('pluginsPage.refresh')}
        </Button>
      </div>

      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <InputGroup className="dshx:h-8 dshx:min-w-[200px] dshx:flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={t('pluginsPage.searchPlaceholder')}
            autoComplete="off"
            onChange={event => setQuery(event.currentTarget.value)}
            placeholder={t('pluginsPage.searchPlaceholder')}
            spellCheck={false}
            type="text"
            value={query}
          />
          {query !== '' && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton aria-label={t('search.clear')} onClick={() => setQuery('')} size="icon-xs">
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>

        <div
          aria-label={t('pluginsPage.scopeLabel')}
          className="dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-0.5 dshx:rounded-lg dshx:border dshx:border-border/70 dshx:bg-muted/80 dshx:p-0.5"
          role="group"
        >
          {(
            [
              { id: 'dshfiles', label: t('pluginsPage.scopeDshfiles'), count: scopeCounts.dshfiles },
              ...(scopeCounts.community > 0 ? [{ id: 'community' as const, label: t('pluginsPage.scopeCommunity'), count: scopeCounts.community }] : []),
              { id: 'all', label: t('pluginsPage.scopeAll'), count: scopeCounts.all },
            ] as const
          ).map(option => {
            const active = effectiveScope === option.id
            return (
              <button
                aria-pressed={active}
                className={cn(
                  'dshx:inline-flex dshx:h-6 dshx:cursor-pointer dshx:items-center dshx:gap-1 dshx:rounded-md dshx:border-none dshx:px-2 dshx:text-xs dshx:transition-colors dshx:duration-100',
                  active
                    ? 'dshx:bg-background dshx:font-medium dshx:text-foreground dshx:shadow-s1'
                    : 'dshx:bg-transparent dshx:text-muted-foreground dshx:hover:text-foreground',
                )}
                data-plugins-scope={option.id}
                key={option.id}
                onClick={() => setScope(option.id)}
                type="button"
              >
                <span>{option.label}</span>
                <span className="dshx:text-2xs dshx:text-muted-foreground/80 dshx:tabular-nums">{option.count}</span>
              </button>
            )
          })}
        </div>

        <div
          aria-label={t('pluginsPage.statusLabel')}
          className="dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-0.5 dshx:rounded-lg dshx:border dshx:border-border/70 dshx:bg-muted/80 dshx:p-0.5"
          role="group"
        >
          {(
            [
              { id: 'all', label: t('pluginsPage.statusAll') },
              { id: 'enabled', label: t('pluginsPage.statusEnabled') },
              { id: 'disabled', label: t('pluginsPage.statusDisabled') },
            ] as const
          ).map(option => {
            const active = status === option.id
            return (
              <button
                aria-pressed={active}
                className={cn(
                  'dshx:inline-flex dshx:h-6 dshx:cursor-pointer dshx:items-center dshx:rounded-md dshx:border-none dshx:px-2 dshx:text-xs dshx:transition-colors dshx:duration-100',
                  active
                    ? 'dshx:bg-background dshx:font-medium dshx:text-foreground dshx:shadow-s1'
                    : 'dshx:bg-transparent dshx:text-muted-foreground dshx:hover:text-foreground',
                )}
                data-plugins-status={option.id}
                key={option.id}
                onClick={() => setStatus(option.id)}
                type="button"
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      {props.error !== undefined && (
        <div
          className="dshx:rounded-xl dshx:border dshx:border-destructive/40 dshx:bg-destructive/5 dshx:px-4 dshx:py-3 dshx:text-sm dshx:text-destructive"
          role="alert"
        >
          {props.error}
        </div>
      )}

      {props.loading && props.bundles.length === 0 && (
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          <Skeleton className="dshx:h-14 dshx:w-full dshx:rounded-xl" />
          <Skeleton className="dshx:h-14 dshx:w-full dshx:rounded-xl" />
          <Skeleton className="dshx:h-14 dshx:w-full dshx:rounded-xl" />
        </div>
      )}

      {!props.loading && props.error === undefined && grouped.length === 0 && (
        <div className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-dashed dshx:border-border dshx:px-6 dshx:py-10 dshx:text-center">
          <PuzzleIcon aria-hidden="true" className="dshx:size-5 dshx:text-muted-foreground" />
          <p className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">{t('pluginsPage.empty')}</p>
        </div>
      )}

      {grouped.map(section => {
        const sectionEnabled = section.items.filter(item => item.enabled).length
        return (
          <section aria-label={section.label} className="dshx:flex dshx:flex-col dshx:gap-2" data-plugins-category={section.id} key={section.id}>
            <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:px-1">
              <h3 className="dshx:m-0 dshx:text-xs dshx:font-semibold dshx:tracking-wide dshx:text-muted-foreground dshx:uppercase">{section.label}</h3>
              <span className="dshx:text-2xs dshx:text-muted-foreground dshx:tabular-nums">
                {sectionEnabled}/{section.items.length}
              </span>
            </div>
            <div className="dshx:divide-y dshx:divide-border/70 dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card">
              {section.items.map(bundle => {
                const title = bundleDisplayTitle(bundle, props.resolveLocaleText)
                const description = bundleDisplayDescription(bundle, props.resolveLocaleText)
                const settingsId = settingsEntryIdForBundle(props.groups, bundle)
                const toggling = pendingNames.has(bundle.name)
                const message = rowMessages.get(bundle.name)
                const dotTone = bundle.pendingRestart !== null ? 'warning' : bundle.enabled ? 'success' : 'muted'
                return (
                  <div
                    className={cn(
                      'dshx:flex dshx:flex-col dshx:gap-1.5 dshx:px-4 dshx:py-3 dshx:transition-colors dshx:duration-100 dshx:hover:bg-accent/25',
                      !bundle.enabled && 'dshx:opacity-80',
                    )}
                    data-dshfiles-bundle={bundle.name}
                    key={bundle.name}
                  >
                    <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:@max-pane-narrow:flex-wrap">
                      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-start dshx:gap-2.5">
                        <StatusDot className="dshx:mt-1.5" tone={dotTone} />
                        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
                          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5">
                            <span className="dshx:text-sm dshx:font-medium dshx:text-foreground">{title}</span>
                            <code className="dshx:rounded dshx:bg-muted dshx:px-1.5 dshx:py-px dshx:font-mono dshx:text-2xs dshx:text-muted-foreground">
                              {bundle.name}
                            </code>
                            {bundle.version !== null && (
                              <span className="dshx:text-2xs dshx:text-muted-foreground/75 dshx:tabular-nums">v{bundle.version}</span>
                            )}
                            {bundle.origin === 'dsh' && <Badge variant="secondary">{t('origin.dsh')}</Badge>}
                            {bundle.readOnlyReason !== null && (
                              <Badge variant="muted">
                                <LockIcon aria-hidden="true" />
                                {t('pluginsPage.protected')}
                              </Badge>
                            )}
                            {bundle.pendingRestart !== null && (
                              <Badge data-pending-restart={bundle.pendingRestart} variant="warning">
                                {bundle.pendingRestart === 'enable' ? t('entryCard.startsAfterRestart') : t('entryCard.stopsAfterRestart')}
                              </Badge>
                            )}
                          </div>
                          {description !== '' && <p className="dshx:m-0 dshx:text-xs dshx:leading-relaxed dshx:text-muted-foreground">{description}</p>}
                        </div>
                      </div>
                      <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2">
                        {settingsId !== undefined && (
                          <Button onClick={() => props.onOpenSettings(settingsId)} size="xs" variant="ghost">
                            <SlidersHorizontalIcon aria-hidden="true" />
                            <span className="dshx:@max-pane-narrow:sr-only">{t('pluginsPage.configure')}</span>
                          </Button>
                        )}
                        <Switch
                          aria-label={t('pluginsPage.toggle', { plugin: title })}
                          checked={bundle.enabled}
                          disabled={bundle.readOnlyReason !== null || toggling}
                          onCheckedChange={next => {
                            void toggle(bundle, next)
                          }}
                        />
                      </div>
                    </div>
                    {message !== undefined && (
                      <p className="dshx:m-0 dshx:pl-4 dshx:text-xs dshx:text-destructive" role="status">
                        {message}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

const ConnectedDshfilesPluginsPage = (props: {
  readonly groups: readonly GroupedEntries[]
  readonly resolveLocaleText: (text: NonNullable<PluginBundle['title']>) => string
  readonly t: ShellTranslate
  readonly onOpenSettings: (entryId: string) => void
}): JSX.Element => {
  const api = useApi(settingsShellApi)
  const queryClient = useQueryClient()
  const bundlesQuery = useQuery({
    queryKey: BUNDLES_QUERY_KEY,
    queryFn: ({ signal }) => api.bundles({}, { signal }),
    staleTime: 30_000,
  })
  const toggleMutation = useMutation({
    mutationFn: (input: { readonly name: string; readonly enabled: boolean }) => api.setBundleEnabled(input),
    onSettled: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: BUNDLES_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: PLUGINS_QUERY_KEY })])
    },
  })
  return (
    <DshfilesPluginsView
      bundles={bundlesQuery.data?.bundles ?? []}
      error={bundlesQuery.isError ? errorMessage(bundlesQuery.error, props.t('pluginsPage.loadError')) : undefined}
      groups={props.groups}
      loading={bundlesQuery.isLoading}
      onOpenSettings={props.onOpenSettings}
      onRefresh={() => {
        void bundlesQuery.refetch()
      }}
      onToggle={(name, enabled) => toggleMutation.mutateAsync({ name, enabled })}
      refreshing={bundlesQuery.isFetching}
      resolveLocaleText={props.resolveLocaleText}
      t={props.t}
    />
  )
}

export const DshfilesPluginsPage = (props: {
  readonly groups: readonly GroupedEntries[]
  readonly resolveLocaleText: (text: NonNullable<PluginBundle['title']>) => string
  readonly t: ShellTranslate
  readonly onOpenSettings: (entryId: string) => void
}): JSX.Element => (
  <PluginQueryProvider>
    <ConnectedDshfilesPluginsPage {...props} />
  </PluginQueryProvider>
)
