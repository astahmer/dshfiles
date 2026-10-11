import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm, SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { defineClient } from '@dshfiles/dshx/client'
import { searchSettingsTargets, settingsNamespaceTitle, type SettingsSearchResult, type SettingsTargetOpener } from './settings-index.js'
import { SETTINGS_SEARCH_LOCALE_NAMESPACE, settingsSearchLocale, type SettingsSearchTranslate } from './locales.js'
import { SettingsFieldEditor } from './settings-field-editor.js'
import { SettingsNavigationSearch } from './navigation-search.js'
import { useSettingsMirror } from './use-settings-mirror.js'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ChevronLeftIcon, ChevronRightIcon, InfoIcon, SearchIcon, SearchXIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import './client.css'

const SETTINGS_SEARCH_ID = 'dshfiles-settings-search'
const MAX_QUERY_LENGTH = 200
const MAX_RESULTS = 60

const scrollActiveIntoView = (element: HTMLButtonElement | null): void => {
  element?.scrollIntoView({ block: 'nearest' })
}

interface SettingsSearchPanelProps {
  readonly describe: SettingsDescribeFace
  readonly getForm: (entryId: string) => ConfigForm<unknown>
  readonly openSettingsTarget?: SettingsTargetOpener
  readonly t: SettingsSearchTranslate
}

const SettingsSearchPanel = (props: SettingsSearchPanelProps): JSX.Element => {
  const describe = props.describe
  const t = props.t
  const { mirror, namespaces, results: allResults } = useSettingsMirror(describe)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [browseEntryId, setBrowseEntryId] = useState<string | null>(null)
  const [selected, setSelected] = useState<SettingsSearchResult | null>(null)

  const namespaceGroups = useMemo(
    () =>
      namespaces.map(namespace => ({
        namespace,
        title: settingsNamespaceTitle(namespace),
        count: allResults.filter(result => result.target.entryId === namespace.ns).length,
      })),
    [allResults, namespaces],
  )
  const trimmedQuery = query.trim()
  const matched = useMemo(() => searchSettingsTargets(allResults, trimmedQuery).slice(0, MAX_RESULTS), [allResults, trimmedQuery])
  const browsedResults = useMemo(
    () => (browseEntryId === null ? [] : allResults.filter(result => result.target.entryId === browseEntryId)),
    [allResults, browseEntryId],
  )
  const visibleResults = trimmedQuery.length > 0 ? matched : browsedResults
  const boundedActiveIndex = Math.min(activeIndex, Math.max(visibleResults.length - 1, 0))
  const selectedNamespace = selected === null ? undefined : namespaces.find(namespace => namespace.ns === selected.target.entryId)
  const selectedTarget = selected === null ? undefined : allResults.find(result => result.id === selected.id)

  const selectResult = (result: SettingsSearchResult): void => {
    if (props.openSettingsTarget?.(result.target) === true) {
      setSelected(null)
      return
    }
    setSelected(result)
  }

  const navigateResults = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && visibleResults.length > 0) {
      event.preventDefault()
      setActiveIndex(index => Math.min(index + 1, visibleResults.length - 1))
    }
    if (event.key === 'ArrowUp' && visibleResults.length > 0) {
      event.preventDefault()
      setActiveIndex(index => Math.max(index - 1, 0))
    }
    if (event.key === 'Enter' && visibleResults[boundedActiveIndex] !== undefined) {
      event.preventDefault()
      selectResult(visibleResults[boundedActiveIndex])
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      if (selected !== null) setSelected(null)
      else if (query.length > 0) setQuery('')
      else setBrowseEntryId(null)
    }
  }

  const header = (
    <header className="dshx:flex dshx:flex-col dshx:gap-1">
      <h1 className="dshx:text-xl dshx:font-semibold">{t('title')}</h1>
      <p className="dshx:text-sm dshx:text-muted-foreground">{selected === null ? t('searchSubtitle') : t('editorSubtitle')}</p>
    </header>
  )

  if (selected !== null) {
    if (selectedNamespace === undefined || selectedTarget === undefined) {
      return (
        <section className="dshx-root dshx:flex dshx:max-w-3xl dshx:flex-col dshx:gap-3 dshx:p-5">
          <Alert role="status" variant="info">
            <InfoIcon />
            <AlertDescription>{t('entryUnavailable')}</AlertDescription>
          </Alert>
          <Button className="dshx:self-start" onClick={() => setSelected(null)} size="sm" type="button" variant="outline">
            {t('backToSearch')}
          </Button>
        </section>
      )
    }
    return (
      <div className="dshx-root dshx:flex dshx:max-w-3xl dshx:flex-col dshx:gap-5 dshx:p-5">
        {header}
        <SettingsFieldEditor
          key={selectedTarget.id}
          form={props.getForm(selectedTarget.target.entryId)}
          namespace={selectedNamespace}
          onBack={() => setSelected(null)}
          result={selectedTarget}
          t={t}
        />
      </div>
    )
  }

  return (
    <main className="dshx-root dshx:flex dshx:max-w-3xl dshx:flex-col dshx:gap-4 dshx:p-5">
      {header}
      <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={t('searchSettings')}
            autoComplete="off"
            autoFocus
            maxLength={MAX_QUERY_LENGTH}
            onChange={event => {
              setQuery(event.currentTarget.value)
              setActiveIndex(0)
            }}
            onKeyDown={navigateResults}
            placeholder={t('searchPlaceholder')}
            type="search"
            value={query}
          />
          {query.length > 0 && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={t('clearSearch')}
                onClick={() => {
                  setQuery('')
                  setActiveIndex(0)
                }}
                size="icon-xs"
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {trimmedQuery.length > 0 && (
          <p className="dshx:px-0.5 dshx:text-xs dshx:text-muted-foreground">
            {t(matched.length === 1 ? 'matchCountOne' : 'matchCountOther', { count: matched.length })}
          </p>
        )}
      </div>
      {mirror.status === 'loading' && (
        <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground" role="status">
          <Spinner aria-hidden="true" role="presentation" />
          {t('loadingDescriptors')}
        </p>
      )}
      {mirror.error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{t('readFailed', { error: mirror.error })}</AlertDescription>
        </Alert>
      )}
      {trimmedQuery.length === 0 && browseEntryId === null && (
        <section aria-label={t('settingsEntries')} className="dshx:flex dshx:flex-col dshx:gap-1">
          <h2 className="dshx:px-2 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{t('categoriesHeading')}</h2>
          {namespaceGroups.map(({ namespace, title, count }) => (
            <button
              className="dshx:group dshx:flex dshx:w-full dshx:items-center dshx:gap-3 dshx:rounded-md dshx:px-2 dshx:py-1.5 dshx:text-left dshx:transition-colors dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:bg-accent dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-default dshx:disabled:opacity-50 dshx:disabled:hover:bg-transparent"
              disabled={count === 0}
              key={namespace.ns}
              onClick={() => {
                setBrowseEntryId(namespace.ns)
                setActiveIndex(0)
              }}
              type="button"
            >
              <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                <span className="dshx:truncate dshx:text-sm dshx:font-medium">{title}</span>
                <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
                  <span className="dshx:font-mono">{namespace.ns}</span> ·{' '}
                  {t(count === 1 ? 'searchableSettingCountOne' : 'searchableSettingCountOther', { count })}
                </span>
              </span>
              <ChevronRightIcon className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
            </button>
          ))}
          {namespaceGroups.length === 0 && mirror.status === 'ready' && <p className="dshx:px-2 dshx:text-sm dshx:text-muted-foreground">{t('noEntries')}</p>}
        </section>
      )}
      {trimmedQuery.length === 0 && browseEntryId !== null && (
        <Button className="dshx:-ml-2 dshx:self-start" onClick={() => setBrowseEntryId(null)} size="sm" type="button" variant="ghost">
          <ChevronLeftIcon />
          {t('allCategories')}
        </Button>
      )}
      {visibleResults.length > 0 && (
        <section aria-label={t('matchingSettings')} className="dshx:flex dshx:flex-col dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:bg-card">
          {visibleResults.map((result, index) => (
            <button
              aria-current={index === boundedActiveIndex ? 'true' : undefined}
              className="dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:border-b dshx:px-3 dshx:py-2 dshx:text-left dshx:transition-colors dshx:outline-none dshx:last:border-b-0 dshx:hover:bg-accent dshx:focus-visible:bg-accent dshx:aria-[current=true]:bg-accent"
              key={result.id}
              onClick={() => selectResult(result)}
              ref={index === boundedActiveIndex ? scrollActiveIntoView : undefined}
              type="button"
            >
              <span className="dshx:truncate dshx:text-sm dshx:font-medium">{result.title}</span>
              <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{result.context}</span>
              {result.description.length > 0 && <span className="dshx:line-clamp-1 dshx:text-xs dshx:text-muted-foreground">{result.description}</span>}
              {result.options.length > 0 && (
                <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
                  {t('optionsLabel')}{' '}
                  {result.options
                    .slice(0, 8)
                    .map(option => option.label)
                    .join(', ')}
                  {result.options.length > 8 ? t('moreOptions', { count: result.options.length - 8 }) : ''}
                </span>
              )}
            </button>
          ))}
        </section>
      )}
      {trimmedQuery.length > 0 && matched.length === 0 && mirror.status === 'ready' && (
        <Empty className="dshx:border dshx:p-6 dshx:md:p-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle className="dshx:text-sm">{t('noMatches')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      <p className="dshx:text-xs dshx:text-muted-foreground">{t('keyboardHint')}</p>
    </main>
  )
}

export default defineClient({
  name: '@dshfiles/settings-search',
  locales: [settingsSearchLocale],
  inject: ['slots', 'configForms'],
  setup(ctx, decorate) {
    const getForm = (entryId: string): ConfigForm<unknown> => ctx.configForms.get<unknown>(entryId)
    const translate = ctx.locale.bind(SETTINGS_SEARCH_LOCALE_NAMESPACE)
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: SETTINGS_SEARCH_ID,
          order: 0,
          label: () => translate('sectionLabel'),
          locale: SETTINGS_SEARCH_LOCALE_NAMESPACE,
        },
        ({ t, openSettingsTarget }: { readonly t: SettingsSearchTranslate; readonly openSettingsTarget?: SettingsTargetOpener }) => (
          <SettingsSearchPanel describe={ctx.configForms.describe()} getForm={getForm} openSettingsTarget={openSettingsTarget} t={t} />
        ),
      ),
    )
    // The shell's title seat is a single cell; priority -1 shadows its plain title so the search sits above the nav.
    ctx.slots.inject('settings.header', () =>
      ctx.slots.register(
        { name: 'settings.header', priority: -1, locale: SETTINGS_SEARCH_LOCALE_NAMESPACE },
        decorate(({ t, openSettingsTarget }: { readonly t: SettingsSearchTranslate; readonly openSettingsTarget?: SettingsTargetOpener }) => (
          <SettingsNavigationSearch describe={ctx.configForms.describe()} getForm={getForm} openSettingsTarget={openSettingsTarget} t={t} />
        )),
      ),
    )
  },
})
