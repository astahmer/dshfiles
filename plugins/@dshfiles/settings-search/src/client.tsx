import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm, ConfigFormSnapshot, SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { defineClient } from '@dshfiles/dshx/client'
import {
  formatSettingsDraft,
  hasSettingsPath,
  parseSettingsDraft,
  readSettingsPath,
  schemaNodeAtPath,
  setOperationForSettingsTarget,
  settingsEditorKind,
  unsetOperationForSettingsTarget,
} from './settings-editor-model.js'
import {
  describeSettingsTargets,
  searchSettingsTargets,
  settingsChoiceOptions,
  settingsNamespaceTitle,
  type SettingsSearchNamespace,
  type SettingsSearchResult,
} from './settings-index.js'
import { SETTINGS_SEARCH_LOCALE_NAMESPACE, settingsSearchLocale, type SettingsSearchTranslate } from './locales.js'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { Field, FieldDescription, FieldLabel } from '@dshfiles/plugin-ui/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { ChevronLeftIcon, ChevronRightIcon, InfoIcon, RefreshCwIcon, SearchIcon, SearchXIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import './client.css'

const SETTINGS_SEARCH_ID = 'dshfiles-settings-search'
const MAX_QUERY_LENGTH = 200
const MAX_RESULTS = 60
const SETTINGS_SEARCH_VALUE_ID = 'settings-search-value'

const scrollActiveIntoView = (element: HTMLButtonElement | null): void => {
  element?.scrollIntoView({ block: 'nearest' })
}

interface SettingsSearchPanelProps {
  readonly describe: SettingsDescribeFace
  readonly getForm: (entryId: string) => ConfigForm<unknown>
  readonly t: SettingsSearchTranslate
}

interface SettingsFieldEditorProps {
  readonly result: SettingsSearchResult
  readonly namespace: SettingsSearchNamespace
  readonly form: ConfigForm<unknown>
  readonly onBack: () => void
  readonly t: SettingsSearchTranslate
}

const snapshotFor = (form: ConfigForm<unknown>): ConfigFormSnapshot<unknown> => form.getSnapshot()

const SettingsFieldEditor = (props: SettingsFieldEditorProps): JSX.Element => {
  const form = props.form
  const t = props.t
  const snapshot = useSyncExternalStore(
    useCallback(listener => form.subscribe(listener), [form]),
    useCallback(() => snapshotFor(form), [form]),
    useCallback(() => snapshotFor(form), [form]),
  )
  const path = props.result.target.fieldPath
  const schema = schemaNodeAtPath(props.namespace.schema, path)
  const choices = useMemo(
    () => settingsChoiceOptions(schemaNodeAtPath(props.namespace.schema, props.result.target.fieldPath)),
    [props.namespace.schema, props.result.id],
  )
  const value = readSettingsPath(snapshot.value, path)
  const kind = settingsEditorKind(schema, value, choices)
  const overridden = hasSettingsPath(snapshot.user, path)
  const [draft, setDraft] = useState(() => formatSettingsDraft(value, kind, choices))
  const [draftRevision, setDraftRevision] = useState(snapshot.revision)
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const canWrite = snapshot.status === 'ready' && snapshot.writable && snapshot.revision !== undefined && !pending
  const parsed = parseSettingsDraft(draft, kind, choices)

  useEffect(() => {
    if (!dirty) {
      setDraft(formatSettingsDraft(value, kind, choices))
      setDraftRevision(snapshot.revision)
    }
  }, [choices, dirty, kind, snapshot.revision, value])

  const save = async (): Promise<void> => {
    if (!canWrite || draftRevision === undefined) return
    if (!parsed.ok) {
      setMessage(t(parsed.messageKey))
      return
    }
    setPending(true)
    setMessage(null)
    try {
      const accepted = await form.mutate(setOperationForSettingsTarget(props.result.target, parsed.value), draftRevision)
      setMessage(accepted ? t('saved') : t('hostRefusedKeepDraft'))
      setConflict(!accepted)
      if (accepted) setDirty(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('saveFailed'))
    } finally {
      setPending(false)
    }
  }

  const reset = async (): Promise<void> => {
    if (!canWrite || !overridden) return
    setPending(true)
    setMessage(null)
    try {
      const accepted = await form.mutate(unsetOperationForSettingsTarget(props.result.target), snapshot.revision)
      setMessage(accepted ? t('restored') : t('hostRefused'))
      setConflict(!accepted)
      if (accepted) setDirty(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('resetFailed'))
    } finally {
      setPending(false)
    }
  }

  const updateDraft = (next: string): void => {
    if (!dirty) setDraftRevision(snapshot.revision)
    setDraft(next)
    setDirty(true)
    setMessage(null)
  }

  const reloadLatest = (): void => {
    setDraft(formatSettingsDraft(value, kind, choices))
    setDraftRevision(snapshot.revision)
    setDirty(false)
    setConflict(false)
    setMessage(null)
  }

  return (
    <section aria-labelledby="settings-search-editor-title" className="dshx:flex dshx:flex-col dshx:gap-4">
      <Button className="dshx:-ml-2 dshx:self-start" onClick={props.onBack} size="sm" type="button" variant="ghost">
        <ChevronLeftIcon />
        {t('backToResults')}
      </Button>
      <div className="dshx:flex dshx:flex-col dshx:gap-1">
        <p className="dshx:text-xs dshx:text-muted-foreground">{props.result.context}</p>
        <h2 className="dshx:text-sm dshx:font-semibold" id="settings-search-editor-title">
          {props.result.title}
        </h2>
        {props.result.description.length > 0 && <p className="dshx:text-sm dshx:text-muted-foreground">{props.result.description}</p>}
        <code className="dshx:font-mono dshx:text-xs dshx:break-all dshx:text-muted-foreground">
          {props.result.target.entryId} · {path.join(' · ')}
        </code>
      </div>
      {snapshot.status === 'loading' && (
        <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground" role="status">
          <Spinner aria-hidden="true" role="presentation" />
          {t('loadingSetting')}
        </p>
      )}
      {snapshot.status === 'unavailable' && (
        <Alert role="status" variant="info">
          <InfoIcon />
          <AlertDescription>{t('settingUnavailable')}</AlertDescription>
        </Alert>
      )}
      {snapshot.status === 'ready' && (
        <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-4">
          <Field className="dshx:flex-col dshx:gap-2">
            <FieldLabel htmlFor={SETTINGS_SEARCH_VALUE_ID}>{t('currentValue')}</FieldLabel>
            {kind === 'boolean' || kind === 'choice' ? (
              <Select disabled={!canWrite} name="settings-search-value" onValueChange={updateDraft} value={draft}>
                <SelectTrigger autoFocus className="dshx:w-full dshx:max-w-sm" id={SETTINGS_SEARCH_VALUE_ID}>
                  <SelectValue placeholder={t('chooseOption')} />
                </SelectTrigger>
                <SelectContent>
                  {kind === 'choice' ? (
                    choices.map((choice, index) => (
                      <SelectItem key={String(index)} value={String(index)}>
                        {choice.label}
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="true">true</SelectItem>
                      <SelectItem value="false">false</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            ) : (
              <Textarea
                autoComplete="off"
                autoFocus
                className={kind === 'string' ? 'dshx:min-h-20' : 'dshx:min-h-28 dshx:font-mono! dshx:text-xs'}
                disabled={!canWrite}
                id={SETTINGS_SEARCH_VALUE_ID}
                onChange={event => updateDraft(event.currentTarget.value)}
                rows={kind === 'string' ? 4 : 6}
                value={draft}
              />
            )}
            <FieldDescription className="dshx:text-xs">
              {snapshot.writable ? t('hostDocumentRevision', { revision: snapshot.revision ?? t('revisionPending') }) : t('readOnly')}
              {` · ${overridden ? t('customValue') : t('inheritedValue')}`}
            </FieldDescription>
          </Field>
          {message !== null && (
            <p className="dshx:text-xs dshx:text-muted-foreground" role="status">
              {message}
            </p>
          )}
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <Button
              disabled={!canWrite || !dirty || !parsed.ok}
              onClick={() => {
                void save()
              }}
              size="sm"
              type="button"
            >
              {pending ? t('saving') : t('saveSetting')}
            </Button>
            <Button
              disabled={!canWrite || !overridden}
              onClick={() => {
                void reset()
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {t('restoreInherited')}
            </Button>
            {conflict && (
              <Button disabled={pending} onClick={reloadLatest} size="sm" type="button" variant="ghost">
                <RefreshCwIcon />
                {t('reloadLatest')}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

const SettingsSearchPanel = (props: SettingsSearchPanelProps): JSX.Element => {
  const describe = props.describe
  const t = props.t
  const mirror = useSyncExternalStore(
    useCallback(listener => describe.subscribe(listener), [describe]),
    useCallback(() => describe.getSnapshot(), [describe]),
    useCallback(() => describe.getSnapshot(), [describe]),
  )
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [browseEntryId, setBrowseEntryId] = useState<string | null>(null)
  const [selected, setSelected] = useState<SettingsSearchResult | null>(null)

  useEffect(() => {
    void describe.ensure()
  }, [describe])

  const namespaces = mirror.view?.namespaces ?? []
  const allResults = useMemo(() => describeSettingsTargets(namespaces), [namespaces])
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
          {namespaceGroups.length === 0 && mirror.status === 'ready' && (
            <p className="dshx:px-2 dshx:text-sm dshx:text-muted-foreground">{t('noEntries')}</p>
          )}
        </section>
      )}
      {trimmedQuery.length === 0 && browseEntryId !== null && (
        <Button className="dshx:-ml-2 dshx:self-start" onClick={() => setBrowseEntryId(null)} size="sm" type="button" variant="ghost">
          <ChevronLeftIcon />
          {t('allCategories')}
        </Button>
      )}
      {visibleResults.length > 0 && (
        <section
          aria-label={t('matchingSettings')}
          className="dshx:flex dshx:flex-col dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:bg-card"
        >
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
              {result.description.length > 0 && (
                <span className="dshx:line-clamp-1 dshx:text-xs dshx:text-muted-foreground">{result.description}</span>
              )}
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
  setup(ctx) {
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
        ({ t }) => <SettingsSearchPanel describe={ctx.configForms.describe()} getForm={getForm} t={t} />,
      ),
    )
  },
})
