import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import type { JujutsuState, Mutation, Revision } from './api.js'
import { describeDraftChanged, graphParentLinks, matchesRevisionSearch } from './graph.js'
import { jujutsuApi } from './api.js'
import type { JujutsuTranslate } from './locales.js'
import styles from './jujutsu.module.css'

interface Preview {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly summary: string
  readonly detail: string
  readonly expiresAt: number
}

interface RevisionDetails {
  readonly files: readonly { readonly path: string; readonly additions: number; readonly deletions: number }[]
  readonly additions: number
  readonly deletions: number
  readonly patch: string
  readonly truncated: boolean
  readonly evolution: string
}

const REPO_HISTORY_KEY = 'dshfiles.jujutsu.repositories'
const SELECTED_REPO_KEY = 'dshfiles.jujutsu.selected'

const relativeTime = (input: { readonly value: string; readonly t: JujutsuTranslate }): string => {
  const time = Date.parse(input.value)
  if (!Number.isFinite(time)) return input.t('unknownTime')
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000))
  if (seconds < 60) return input.t('relativeNow')
  if (seconds < 3600) return input.t('relativeMinutes', { count: Math.floor(seconds / 60) })
  if (seconds < 86_400) return input.t('relativeHours', { count: Math.floor(seconds / 3600) })
  if (seconds < 604_800) return input.t('relativeDays', { count: Math.floor(seconds / 86_400) })
  return new Date(time).toLocaleDateString()
}

const dayLabel = (input: { readonly value: string; readonly t: JujutsuTranslate }): string => {
  const time = Date.parse(input.value)
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    : input.t('dateUnavailable')
}

const safeSplitPath = (path: string): boolean =>
  path.length > 0 &&
  path.length <= 1024 &&
  !path.includes('\0') &&
  !path.includes('\n') &&
  !path.includes('\r') &&
  !path.startsWith('/') &&
  path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')

const groupRows = (input: {
  readonly revisions: readonly Revision[]
  readonly t: JujutsuTranslate
}): readonly { readonly day: string; readonly rows: readonly Revision[] }[] => {
  const groups = new Map<string, Revision[]>()
  for (const revision of input.revisions) {
    const key = dayLabel({ value: revision.authorTime, t: input.t })
    const rows = groups.get(key) ?? []
    rows.push(revision)
    groups.set(key, rows)
  }
  return [...groups].map(([day, rows]) => ({ day, rows }))
}

export const JujutsuPanel = (props: { readonly t: JujutsuTranslate; readonly surface?: 'main' | 'side-panel' }): JSX.Element => {
  const sidePanel = props.surface === 'side-panel'
  const api = useApi(jujutsuApi)
  const t = props.t
  const [path, setPath] = useState('')
  const [repoId, setRepoId] = useState<string | null>(null)
  const [repoHistory, setRepoHistory] = useState<readonly string[]>([])
  const [state, setState] = useState<JujutsuState | null>(null)
  const [tab, setTab] = useState<'graph' | 'source'>('graph')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [authorFilter, setAuthorFilter] = useState('')
  const [textFilter, setTextFilter] = useState('')
  const [mineOnly, setMineOnly] = useState(false)
  const [hideImmutable, setHideImmutable] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [details, setDetails] = useState<RevisionDetails | null>(null)
  const [describeDrafts, setDescribeDrafts] = useState<Readonly<Record<string, string>>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [actionOutput, setActionOutput] = useState('')
  const [remote, setRemote] = useState('')
  const [bookmark, setBookmark] = useState('')
  const [ancestorLimit, setAncestorLimit] = useState(5)
  const [splitPaths, setSplitPaths] = useState<readonly string[]>([])
  const [splitText, setSplitText] = useState('')
  const [squashText, setSquashText] = useState('')
  const [squashTarget, setSquashTarget] = useState('')
  const [workingPatch, setWorkingPatch] = useState<string | null>(null)
  const previewRequestId = useRef(0)
  const selectedRevisionRef = useRef<Revision | null>(null)
  const autoRegisterPath = useRef<string | null>(null)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(REPO_HISTORY_KEY) ?? '[]') as unknown
      if (Array.isArray(saved)) setRepoHistory(saved.filter((item): item is string => typeof item === 'string').slice(0, 12))
      setPath(localStorage.getItem(SELECTED_REPO_KEY) ?? '')
    } catch {
      setRepoHistory([])
    }
  }, [])

  useEffect(() => {
    if (repoId === null) return
    let stale = false
    setBusy(true)
    setError(null)
    void api
      .load({ repoId, limit: 300 })
      .then(result => {
        if (stale) return
        setState(result)
        setWorkingPatch(null)
        const previous = selectedRevisionRef.current
        const selection =
          previous === null
            ? undefined
            : (result.revisions.find(row => row.commitId === previous.commitId) ?? result.revisions.find(row => row.changeId === previous.changeId))
        selectedRevisionRef.current = selection ?? null
        setSelectedId(selection?.commitId ?? null)
        const visibleCommitIds = new Set(result.revisions.map(row => row.commitId))
        setDescribeDrafts(current => Object.fromEntries(Object.entries(current).filter(([commitId]) => visibleCommitIds.has(commitId))))
      })
      .catch(reason => {
        if (!stale) setError(reason instanceof Error ? reason.message : t('loadRepositoryFailed'))
      })
      .finally(() => {
        if (!stale) setBusy(false)
      })
    return () => {
      stale = true
    }
  }, [repoId, reloadKey, t])

  useEffect(() => {
    if (repoId === null || selectedId === null) {
      setDetails(null)
      return
    }
    let stale = false
    setDetails(null)
    void api
      .details({ repoId, commitId: selectedId })
      .then(result => {
        if (!stale) setDetails(result)
      })
      .catch(reason => {
        if (!stale) setError(reason instanceof Error ? reason.message : t('loadDetailsFailed'))
      })
    return () => {
      stale = true
    }
  }, [repoId, selectedId, t])

  useEffect(() => {
    if (state === null) return
    if (remote === '' || !state.remoteNames.includes(remote)) setRemote(state.remoteNames[0] ?? '')
    const working = state.revisions.find(revision => revision.workingCopy)
    const firstLocalBookmark = working?.localBookmarks[0] ?? state.revisions.find(row => row.localBookmarks.length > 0)?.localBookmarks[0] ?? ''
    if (bookmark === '' || !state.revisions.some(row => row.localBookmarks.includes(bookmark))) setBookmark(firstLocalBookmark)
  }, [state])

  const visibleRevisions = useMemo(() => {
    if (state === null) return []
    return state.revisions.filter(revision => {
      if (mineOnly && !revision.mine) return false
      if (hideImmutable && revision.immutable) return false
      if (authorFilter && !revision.author.toLocaleLowerCase().includes(authorFilter.toLocaleLowerCase())) return false
      const timestamp = Date.parse(revision.authorTime)
      if (fromDate && Number.isFinite(timestamp) && timestamp < Date.parse(fromDate + 'T00:00:00')) return false
      if (toDate && Number.isFinite(timestamp) && timestamp > Date.parse(toDate + 'T23:59:59')) return false
      if (!matchesRevisionSearch(revision, textFilter)) return false
      return true
    })
  }, [state, mineOnly, hideImmutable, authorFilter, textFilter, fromDate, toDate])

  const revisionsByCommitId = useMemo(() => new Map(state?.revisions.map(revision => [revision.commitId, revision]) ?? []), [state])

  const groups = useMemo(() => groupRows({ revisions: visibleRevisions, t }), [visibleRevisions, t])
  const workingCopy = state?.revisions.find(revision => revision.workingCopy)
  const selectedRevision = state?.revisions.find(revision => revision.commitId === selectedId)
  const selectedDescribeText =
    selectedRevision === undefined ? '' : (describeDrafts[selectedRevision.commitId] ?? selectedRevision.description.replace(/\n+$/, ''))
  const workingDescribeText = workingCopy === undefined ? '' : (describeDrafts[workingCopy.commitId] ?? workingCopy.description.replace(/\n+$/, ''))
  const selectedDescribeChanged = selectedRevision !== undefined && describeDraftChanged(selectedDescribeText, selectedRevision.description)
  const workingDescribeChanged = workingCopy !== undefined && describeDraftChanged(workingDescribeText, workingCopy.description)
  const ancestors = useMemo(() => {
    if (state === null || workingCopy === undefined) return []
    const byId = new Map(state.revisions.map(revision => [revision.commitId, revision]))
    const result: { readonly depth: number; readonly revision: Revision }[] = []
    let cursor = workingCopy
    for (let depth = 1; depth <= ancestorLimit; depth += 1) {
      const parentId = cursor.parents[0]
      if (parentId === undefined) break
      const parent = byId.get(parentId)
      if (parent === undefined) break
      result.push({ depth, revision: parent })
      cursor = parent
    }
    return result
  }, [state, workingCopy, ancestorLimit])

  const registerPath = useCallback(async (repositoryPath: string): Promise<void> => {
    const selectedPath = repositoryPath.trim()
    if (selectedPath.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const registered = await api.registerRepository({ path: selectedPath })
      previewRequestId.current += 1
      setPreview(null)
      setRepoId(registered.repoId)
      setPath(registered.root)
      setState(null)
      selectedRevisionRef.current = null
      setSelectedId(null)
      setDescribeDrafts({})
      const next = [registered.root, ...repoHistory.filter(item => item !== registered.root)].slice(0, 12)
      setRepoHistory(next)
      localStorage.setItem(REPO_HISTORY_KEY, JSON.stringify(next))
      localStorage.setItem(SELECTED_REPO_KEY, registered.root)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('registerFailed'))
    } finally {
      setBusy(false)
    }
  }, [api, repoHistory, t])

  useEffect(() => {
    const selectedPath = path.trim()
    if (!sidePanel || repoId !== null || selectedPath.length === 0 || autoRegisterPath.current === selectedPath) return
    autoRegisterPath.current = selectedPath
    void registerPath(selectedPath)
  }, [registerPath, sidePanel, path, repoId])

  const register = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    await registerPath(path)
  }

  const askForConfirmation = async (action: Mutation): Promise<void> => {
    if (repoId === null) return
    const requestId = ++previewRequestId.current
    setPreview(null)
    setError(null)
    setActionOutput('')
    try {
      const next = await api.prepare({ repoId, action })
      if (previewRequestId.current === requestId) setPreview(next)
    } catch (reason) {
      if (previewRequestId.current === requestId) setError(reason instanceof Error ? reason.message : t('prepareFailed'))
    }
  }

  const confirm = async (): Promise<void> => {
    if (repoId === null || preview === null) return
    const confirmedRepoId = repoId
    previewRequestId.current += 1
    setPreview(null)
    setBusy(true)
    setError(null)
    try {
      const result = await api.confirm({ repoId: confirmedRepoId, previewId: preview.id })
      setActionOutput(result.output)
      setPreview(null)
      setReloadKey(value => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('actionFailed'))
    } finally {
      setBusy(false)
      setReloadKey(value => value + 1)
    }
  }

  const startDrag = (event: DragEvent, revision: Revision): void => {
    event.dataTransfer.setData('application/x-jujutsu-revision', revision.commitId)
    event.dataTransfer.effectAllowed = 'move'
  }

  const dropOn = (event: DragEvent, revision: Revision): void => {
    event.preventDefault()
    const draggedBookmark = event.dataTransfer.getData('application/x-jujutsu-bookmark')
    const draggedRevision = event.dataTransfer.getData('application/x-jujutsu-revision')
    if (draggedBookmark) void askForConfirmation({ kind: 'bookmark-move', bookmark: draggedBookmark, destinationId: revision.commitId })
    else if (draggedRevision) void askForConfirmation({ kind: 'rebase', sourceId: draggedRevision, destinationId: revision.commitId })
  }

  const loadWorkingDiff = async (): Promise<void> => {
    if (repoId === null) return
    setError(null)
    try {
      const result = await api.workingDiff({ repoId })
      setWorkingPatch(result.patch)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('workingDiffFailed'))
    }
  }

  return (
    <main className={sidePanel ? `${styles.panel} ${styles.sidePanel}` : styles.panel}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div>
            <h1>{t('title')}</h1>
            <div className={styles.muted}>{state?.root ?? t('selectRepositoryHint')}</div>
          </div>
          <button type="button" className={styles.secondary} disabled={busy || repoId === null} onClick={() => setReloadKey(value => value + 1)}>
            {t('refresh')}
          </button>
        </div>
        <form className={styles.repoForm} onSubmit={event => void register(event)}>
          <input
            aria-label={t('repositoryPath')}
            list="jj-repositories"
            value={path}
            onChange={event => setPath(event.target.value)}
            placeholder={t('repositoryPathPlaceholder')}
          />
          <datalist id="jj-repositories">
            {repoHistory.map(item => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <button type="submit" disabled={busy || path.trim().length === 0}>
            {repoId === null ? t('openRepository') : t('selectRepository')}
          </button>
          <select aria-label={t('remote')} value={remote} onChange={event => setRemote(event.target.value)} disabled={!state?.remoteNames.length}>
            {state?.remoteNames.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.secondary}
            disabled={repoId === null || remote === '' || busy}
            onClick={() => void askForConfirmation({ kind: 'fetch', remote })}
          >
            {t('fetch')}
          </button>
          <select aria-label={t('bookmarkToPush')} value={bookmark} onChange={event => setBookmark(event.target.value)} disabled={!bookmark}>
            {state?.revisions
              .flatMap(row => row.localBookmarks)
              .filter((name, index, all) => all.indexOf(name) === index)
              .map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
          <button
            type="button"
            className={styles.secondary}
            disabled={repoId === null || remote === '' || bookmark === '' || busy}
            onClick={() => void askForConfirmation({ kind: 'push', remote, bookmark })}
          >
            {t('push')}
          </button>
        </form>
        {state !== null && (
          <>
            <div className={styles.statusLine} title={state.lastPushDescription ?? t('lastPushHint')}>
              {t('lastPushLabel')}{' '}
              {state.lastPushAt
                ? state.lastPushHistoryTruncated
                  ? t('lastPushScanLimited', { time: relativeTime({ value: state.lastPushAt, t }) })
                  : relativeTime({ value: state.lastPushAt, t })
                : state.lastPushHistoryTruncated
                  ? t('lastPushNotFoundLimited')
                  : t('lastPushNotFound')}
            </div>
            {state.evolutionHistoryTruncated && <div className={styles.statusLine}>{t('evolutionScanLimited')}</div>}
          </>
        )}
        <nav className={styles.tabs} aria-label={t('views')}>
          <button type="button" className={tab === 'graph' ? styles.activeTab : ''} onClick={() => setTab('graph')}>
            {t('revisionGraph')}
          </button>
          <button type="button" className={tab === 'source' ? styles.activeTab : ''} onClick={() => setTab('source')}>
            {t('sourceControl')}
          </button>
        </nav>
      </header>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {actionOutput && <pre className={styles.output}>{actionOutput}</pre>}
      {busy && (
        <div className={styles.loading} role="status">
          {t('working')}
        </div>
      )}

      {tab === 'graph' && state !== null && (
        <section className={styles.graphView}>
          <div className={styles.filters}>
            <input
              aria-label={t('filterAuthor')}
              value={authorFilter}
              onChange={event => setAuthorFilter(event.target.value)}
              placeholder={t('authorPlaceholder')}
            />
            <input
              aria-label={t('searchRevisions')}
              value={textFilter}
              onChange={event => setTextFilter(event.target.value)}
              placeholder={t('searchRevisionsPlaceholder')}
            />
            <label>
              <input type="checkbox" checked={mineOnly} onChange={event => setMineOnly(event.target.checked)} /> {t('mineOnly')}
            </label>
            <label>
              <input type="checkbox" checked={hideImmutable} onChange={event => setHideImmutable(event.target.checked)} /> {t('hideImmutable')}
            </label>
            <label>
              {t('fromDate')} <input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} />
            </label>
            <label>
              {t('toDate')} <input type="date" value={toDate} onChange={event => setToDate(event.target.value)} />
            </label>
          </div>
          <div className={styles.graphColumns}>
            <div className={styles.revisionList}>
              {groups.map(group => (
                <div className={styles.dayGroup} key={group.day}>
                  <div className={styles.dayHeading}>{group.day}</div>
                  {group.rows.map(revision => (
                    <article
                      className={selectedId === revision.commitId ? styles.revisionSelected : styles.revision}
                      key={revision.commitId}
                      onDragOver={event => event.preventDefault()}
                      onDrop={event => dropOn(event, revision)}
                    >
                      <div className={styles.graphRail} aria-hidden>
                        <span className={revision.workingCopy ? styles.nodeCurrent : styles.node} />
                      </div>
                      <button
                        type="button"
                        className={styles.revisionBody}
                        onClick={() => {
                          selectedRevisionRef.current = revision
                          setSelectedId(revision.commitId)
                        }}
                      >
                        <div className={styles.revisionTitle}>
                          {revision.workingCopy && <span className={styles.currentBadge}>{t('editingBadge')}</span>}
                          <span>{revision.description.split('\n')[0] || t('noDescription')}</span>
                        </div>
                        <div className={styles.revisionMeta}>
                          <span>{revision.author || t('unknownAuthor')}</span>
                          {revision.workspaces.map(workspace => (
                            <span className={styles.workspaceBadge} key={workspace}>
                              {workspace}
                            </span>
                          ))}
                          {graphParentLinks(revision, revisionsByCommitId, hideImmutable).map(link => (
                            <span
                              className={link.hiddenImmutableCount > 0 ? styles.ancestryBridge : styles.parentLink}
                              key={link.commitId}
                              title={link.hiddenImmutableCount > 0 ? t('ancestryBridgeHint') : t('directParentHint')}
                            >
                              {link.hiddenImmutableCount > 0
                                ? t(link.terminal ? 'ancestryBridgeRoot' : 'ancestryBridge', { count: link.hiddenImmutableCount, label: link.label })
                                : t('parentLink', { label: link.label })}
                            </span>
                          ))}
                          {revision.immutable && <span className={styles.immutableBadge}>{t('immutableBadge')}</span>}
                          {revision.evolved && <span className={styles.tag}>{t('evolvedBadge')}</span>}
                          {revision.divergent && <span className={styles.tag}>{t('divergentBadge')}</span>}
                        </div>
                      </button>
                      <span className={styles.relative}>{relativeTime({ value: revision.authorTime, t })}</span>
                      <span className={styles.changeId} title={revision.changeId}>
                        {revision.shortestChangeId}
                      </span>
                      <button
                        type="button"
                        className={styles.dragHandle}
                        draggable
                        onDragStart={event => startDrag(event, revision)}
                        title={t('dragRevisionHint')}
                      >
                        ⠿
                      </button>
                      <div className={styles.labels}>
                        {revision.bookmarks.map(name => (
                          <span
                            draggable={revision.localBookmarks.includes(name)}
                            onDragStart={event => {
                              event.dataTransfer.setData('application/x-jujutsu-bookmark', name)
                              event.dataTransfer.effectAllowed = 'move'
                            }}
                            className={revision.localBookmarks.includes(name) ? styles.bookmark : styles.remoteBookmark}
                            key={name}
                          >
                            {name}
                          </span>
                        ))}
                        {revision.tags.map(name => (
                          <span className={styles.tag} key={name}>
                            {t('tagLabel', { name })}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ))}
              {visibleRevisions.length === 0 && <p className={styles.muted}>{t('noMatchingRevisions')}</p>}
            </div>
            <aside className={styles.details}>
              {selectedRevision ? (
                <>
                  <div className={styles.titleRow}>
                    <h2>{t('revisionHeading', { id: selectedRevision.shortestChangeId })}</h2>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => {
                        selectedRevisionRef.current = null
                        setSelectedId(null)
                      }}
                    >
                      {t('close')}
                    </button>
                  </div>
                  <p>{selectedRevision.description || t('noDescription')}</p>
                  <div className={styles.detailMeta}>
                    {selectedRevision.author} · {new Date(selectedRevision.authorTime).toLocaleString()}
                  </div>
                  {details ? (
                    <>
                      <div className={styles.counts}>
                        {t('fileCounts', { count: details.files.length, additions: details.additions, deletions: details.deletions })}
                        {details.truncated && <span className={styles.tag}>{t('diffTruncated')}</span>}
                      </div>
                      <ul className={styles.fileList}>
                        {details.files.map(file => (
                          <li key={file.path}>
                            <span>{file.path}</span>
                            <span>
                              +{file.additions} −{file.deletions}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <details>
                        <summary>{t('changeEvolution')}</summary>
                        <pre>{details.evolution}</pre>
                      </details>
                      <details open>
                        <summary>{t('diff')}</summary>
                        <pre className={styles.diff}>{details.patch}</pre>
                      </details>
                    </>
                  ) : (
                    <p className={styles.muted}>{t('loadingDetails')}</p>
                  )}
                  {!selectedRevision.immutable && (
                    <div className={styles.actionBox}>
                      <label>
                        {t('newDescription')}
                        <textarea
                          value={selectedDescribeText}
                          onChange={event => setDescribeDrafts(current => ({ ...current, [selectedRevision.commitId]: event.target.value }))}
                          rows={3}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!selectedDescribeChanged}
                        onClick={() => void askForConfirmation({ kind: 'describe', commitId: selectedRevision.commitId, message: selectedDescribeText })}
                      >
                        {t('previewDescribe')}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className={styles.muted}>{t('selectRevisionHint')}</p>
              )}
            </aside>
          </div>
        </section>
      )}

      {tab === 'source' && state !== null && (
        <section className={styles.sourceView}>
          <div className={styles.sourceSummary}>
            <div>
              <h2>{t('workingCopy')}</h2>
              <pre>{state.status || t('cleanWorkingCopy')}</pre>
            </div>
            <div className={styles.sourceActions}>
              <button type="button" className={styles.secondary} onClick={() => void loadWorkingDiff()}>
                {t('showFullDiff')}
              </button>
              <label>
                {t('ancestorGroups')}{' '}
                <select value={ancestorLimit} onChange={event => setAncestorLimit(Number(event.target.value))}>
                  {[1, 2, 3, 4, 5, 8, 10].map(count => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {workingPatch !== null && (
            <details open>
              <summary>{t('workingCopyDiff')}</summary>
              <pre className={styles.diff}>{workingPatch}</pre>
            </details>
          )}
          <div className={styles.sourceColumns}>
            <div className={styles.ancestorList}>
              <h3>{t('ancestorGroups')}</h3>
              {ancestors.map(({ depth, revision }) => (
                <button type="button" className={styles.ancestor} key={revision.commitId} onClick={() => setSquashTarget(revision.commitId)}>
                  <span>@-{depth}</span>
                  <span>{revision.description.split('\n')[0] || t('noDescription')}</span>
                  <code>{revision.shortestChangeId}</code>
                </button>
              ))}
              {ancestors.length === 0 && <p className={styles.muted}>{t('noAncestors')}</p>}
            </div>
            <div className={styles.sourceActions}>
              <h3>{t('describeWorkingCopy')}</h3>
              <textarea
                aria-label={t('workingCopyDescription')}
                value={workingDescribeText}
                onChange={event => workingCopy && setDescribeDrafts(current => ({ ...current, [workingCopy.commitId]: event.target.value }))}
                rows={3}
              />
              {workingCopy && (
                <button
                  type="button"
                  disabled={!workingDescribeChanged}
                  onClick={() => void askForConfirmation({ kind: 'describe', commitId: workingCopy.commitId, message: workingDescribeText })}
                >
                  {t('previewDescribe')}
                </button>
              )}
              <h3>{t('splitHeading')}</h3>
              <div className={styles.fileChoices}>
                {state.changedPaths.map(file => {
                  const selectable = safeSplitPath(file)
                  return (
                    <label key={file} className={!selectable ? styles.disabledFile : ''}>
                      <input
                        type="checkbox"
                        disabled={!selectable}
                        checked={splitPaths.includes(file)}
                        onChange={event => setSplitPaths(current => (event.target.checked ? [...current, file] : current.filter(item => item !== file)))}
                      />
                      {file}
                      {!selectable && <span>{t('unsafePath')}</span>}
                    </label>
                  )
                })}
              </div>
              <textarea
                aria-label={t('splitDescription')}
                value={splitText}
                onChange={event => setSplitText(event.target.value)}
                placeholder={t('splitDescriptionPlaceholder')}
                rows={2}
              />
              {workingCopy && (
                <button
                  type="button"
                  disabled={splitPaths.length === 0 || splitText.trim().length === 0}
                  onClick={() => void askForConfirmation({ kind: 'split', commitId: workingCopy.commitId, paths: [...splitPaths], message: splitText })}
                >
                  {t('previewSplit')}
                </button>
              )}
              <h3>{t('squashHeading')}</h3>
              <select aria-label={t('squashDestination')} value={squashTarget} onChange={event => setSquashTarget(event.target.value)}>
                <option value="">{t('chooseAncestor')}</option>
                {ancestors.map(({ depth, revision }) => (
                  <option key={revision.commitId} value={revision.commitId}>
                    @-{depth} · {revision.shortestChangeId}
                  </option>
                ))}
              </select>
              <textarea
                aria-label={t('squashDescription')}
                value={squashText}
                onChange={event => setSquashText(event.target.value)}
                placeholder={t('squashDescriptionPlaceholder')}
                rows={2}
              />
              {workingCopy && (
                <button
                  type="button"
                  disabled={!squashTarget || squashText.trim().length === 0}
                  onClick={() => void askForConfirmation({ kind: 'squash', sourceId: workingCopy.commitId, destinationId: squashTarget, message: squashText })}
                >
                  {t('previewSquash')}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {preview && (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="jj-preview-title">
            <h2 id="jj-preview-title">{t('confirmActionTitle', { action: preview.title.toLocaleLowerCase() })}</h2>
            <strong>{preview.summary}</strong>
            <pre>{preview.detail}</pre>
            <div className={styles.modalActions}>
              <button type="button" className={styles.secondary} disabled={busy} onClick={() => setPreview(null)}>
                {t('cancel')}
              </button>
              <button type="button" disabled={busy} onClick={() => void confirm()}>
                {t('confirmAndRun')}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
