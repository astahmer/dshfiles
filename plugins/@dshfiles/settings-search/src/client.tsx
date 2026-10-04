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
import styles from './settings-search.module.css'

const SETTINGS_SEARCH_ID = 'dshfiles-settings-search'
const MAX_QUERY_LENGTH = 200
const MAX_RESULTS = 60

interface SettingsSearchPanelProps {
  readonly describe: SettingsDescribeFace
  readonly getForm: (entryId: string) => ConfigForm<unknown>
}

interface SettingsFieldEditorProps {
  readonly result: SettingsSearchResult
  readonly namespace: SettingsSearchNamespace
  readonly form: ConfigForm<unknown>
  readonly onBack: () => void
}

const snapshotFor = (form: ConfigForm<unknown>): ConfigFormSnapshot<unknown> => form.getSnapshot()

const SettingsFieldEditor = (props: SettingsFieldEditorProps): JSX.Element => {
  const form = props.form
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
      setMessage(parsed.message)
      return
    }
    setPending(true)
    setMessage(null)
    try {
      const accepted = await form.mutate(setOperationForSettingsTarget(props.result.target, parsed.value), draftRevision)
      setMessage(accepted ? 'Saved.' : 'The Host refused this change. Your draft is still here.')
      setConflict(!accepted)
      if (accepted) setDirty(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save this setting.')
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
      setMessage(accepted ? 'Restored the inherited value.' : 'The Host refused this change.')
      setConflict(!accepted)
      if (accepted) setDirty(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not reset this setting.')
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
    <section aria-labelledby="settings-search-editor-title" className={styles.editor}>
      <button className={styles.backButton} onClick={props.onBack} type="button">
        ← Back to results
      </button>
      <p className={styles.contextNote}>{props.result.context}</p>
      <h2 id="settings-search-editor-title">{props.result.title}</h2>
      {props.result.description.length > 0 && <p className={styles.description}>{props.result.description}</p>}
      <code className={styles.path}>
        {props.result.target.entryId} · {path.join(' · ')}
      </code>
      {snapshot.status === 'loading' && <p role="status">Loading the current setting…</p>}
      {snapshot.status === 'unavailable' && <p role="status">This setting is not available from the current Host.</p>}
      {snapshot.status === 'ready' && (
        <>
          <label className={styles.valueField}>
            <span>Current value</span>
            {kind === 'boolean' || kind === 'choice' ? (
              <select autoFocus disabled={!canWrite} onChange={event => updateDraft(event.currentTarget.value)} value={draft}>
                {kind === 'choice' ? (
                  <>
                    <option value="">Choose an option…</option>
                    {choices.map((choice, index) => (
                      <option key={String(index)} value={String(index)}>
                        {choice.label}
                      </option>
                    ))}
                  </>
                ) : (
                  <>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </>
                )}
              </select>
            ) : kind === 'string' ? (
              <textarea autoComplete="off" autoFocus disabled={!canWrite} onChange={event => updateDraft(event.currentTarget.value)} rows={4} value={draft} />
            ) : (
              <textarea autoComplete="off" autoFocus disabled={!canWrite} onChange={event => updateDraft(event.currentTarget.value)} rows={6} value={draft} />
            )}
          </label>
          <p className={styles.formHint}>
            {snapshot.writable ? `Host document · revision ${snapshot.revision ?? 'pending'}` : 'The Host settings document is read-only.'}
            {overridden ? ' · Custom value' : ' · Inherited value'}
          </p>
          {message !== null && <p role="status">{message}</p>}
          {conflict && (
            <button disabled={pending} onClick={reloadLatest} type="button">
              Reload latest value
            </button>
          )}
          <footer className={styles.editorActions}>
            <button
              disabled={!canWrite || !dirty || !parsed.ok}
              onClick={() => {
                void save()
              }}
              type="button"
            >
              {pending ? 'Saving…' : 'Save setting'}
            </button>
            <button
              disabled={!canWrite || !overridden}
              onClick={() => {
                void reset()
              }}
              type="button"
            >
              Restore inherited value
            </button>
          </footer>
        </>
      )}
    </section>
  )
}

const SettingsSearchPanel = (props: SettingsSearchPanelProps): JSX.Element => {
  const describe = props.describe
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

  const selectResult = (result: SettingsSearchResult): void => setSelected(result)

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

  if (selected !== null) {
    if (selectedNamespace === undefined || selectedTarget === undefined) {
      return (
        <section className={styles.page}>
          <p role="status">This settings entry is no longer available.</p>
          <button onClick={() => setSelected(null)} type="button">
            Back to search
          </button>
        </section>
      )
    }
    return (
      <div className={styles.page}>
        <header>
          <h1>Settings Search</h1>
          <p>Open and edit the matching setting from its Host configuration entry.</p>
        </header>
        <SettingsFieldEditor
          key={selectedTarget.id}
          form={props.getForm(selectedTarget.target.entryId)}
          namespace={selectedNamespace}
          onBack={() => setSelected(null)}
          result={selectedTarget}
        />
      </div>
    )
  }

  return (
    <main className={styles.page}>
      <header>
        <h1>Settings Search</h1>
        <p>Find a setting by name, description, entry, or section path. Selecting a result opens its live Host-backed value.</p>
      </header>
      <label className={styles.searchLabel}>
        <span className={styles.srOnly}>Search settings</span>
        <input
          autoFocus
          autoComplete="off"
          maxLength={MAX_QUERY_LENGTH}
          onChange={event => {
            setQuery(event.currentTarget.value)
            setActiveIndex(0)
          }}
          onKeyDown={navigateResults}
          placeholder="Search settings…"
          type="search"
          value={query}
        />
      </label>
      {mirror.status === 'loading' && <p role="status">Loading settings descriptors…</p>}
      {mirror.error !== null && <p role="alert">Could not read settings: {mirror.error}</p>}
      {trimmedQuery.length > 0 && (
        <p className={styles.resultCount}>
          {matched.length} {matched.length === 1 ? 'match' : 'matches'}
        </p>
      )}
      {trimmedQuery.length === 0 && browseEntryId === null && (
        <section aria-label="Settings entries" className={styles.namespaceList}>
          <h2>Categories and entries</h2>
          {namespaceGroups.map(({ namespace, title, count }) => (
            <button
              className={styles.namespaceButton}
              disabled={count === 0}
              key={namespace.ns}
              onClick={() => {
                setBrowseEntryId(namespace.ns)
                setActiveIndex(0)
              }}
              type="button"
            >
              <strong>{title}</strong>
              <span>
                {namespace.ns} · {count} searchable {count === 1 ? 'setting' : 'settings'}
              </span>
            </button>
          ))}
          {namespaceGroups.length === 0 && mirror.status === 'ready' && <p>No settings entries are available.</p>}
        </section>
      )}
      {trimmedQuery.length === 0 && browseEntryId !== null && (
        <button className={styles.backButton} onClick={() => setBrowseEntryId(null)} type="button">
          ← All categories and entries
        </button>
      )}
      {visibleResults.length > 0 && (
        <section aria-label="Matching settings" className={styles.results}>
          {visibleResults.map((result, index) => (
            <button
              aria-current={index === boundedActiveIndex ? 'true' : undefined}
              className={styles.result}
              key={result.id}
              onClick={() => selectResult(result)}
              type="button"
            >
              <strong>{result.title}</strong>
              <small>{result.context}</small>
              {result.description.length > 0 && <p>{result.description}</p>}
              {result.options.length > 0 && (
                <small className={styles.optionLabels}>
                  Options:{' '}
                  {result.options
                    .slice(0, 8)
                    .map(option => option.label)
                    .join(', ')}
                  {result.options.length > 8 ? `, +${result.options.length - 8} more` : ''}
                </small>
              )}
            </button>
          ))}
        </section>
      )}
      {trimmedQuery.length > 0 && matched.length === 0 && mirror.status === 'ready' && <p>No settings match this search.</p>}
      <p className={styles.keyboardHint}>↑ ↓ Navigate · Enter Open · Esc Clear</p>
    </main>
  )
}

export default defineClient({
  name: '@dshfiles/settings-search',
  // setup(ctx) reads ctx.slots and ctx.configForms.
  inject: ['slots', 'configForms'],
  setup(ctx) {
    const getForm = (entryId: string): ConfigForm<unknown> => ctx.configForms.get<unknown>(entryId)
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register({ name: 'settings.section', id: SETTINGS_SEARCH_ID, order: 0, label: () => 'Search' }, () => (
        <SettingsSearchPanel describe={ctx.configForms.describe()} getForm={getForm} />
      )),
    )
  },
})
