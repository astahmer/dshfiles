import { useApi } from '@dshfiles/dshx/client'
// Supplies the CSS-module declaration this file's stylesheet import needs.
import type {} from '@dshfiles/dshx/client'
import {
  PROVIDER_ICONS,
  aiAccountsApi,
  type AccountsUsage,
  type UsageCard,
  type AccountDraft,
  type AccountProfile,
  type AccountsFile,
  type AccountsCatalog,
  type OverlaySettings,
} from './api.js'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import styles from './accounts.module.css'

/**
 * The accounts page, in the shape of the reference account page: a rail of
 * toggleable providers on one side, the selected provider's numbered settings
 * sections on the other, inside one bordered shell.
 *
 * Every write goes through the Host, which also owns the file, so the page and an
 * agent share one source of truth. Nothing here holds a credential: an account
 * shows whether it holds a login, who that login belongs to, and the exact
 * command that creates one.
 */

const KIND_LABEL: Record<AccountProfile['kind'], string> = {
  codex: 'Codex',
  'opencode-go': 'OpenCode Go',
  commandcode: 'Command Code',
}

/** Rail group headings, in the order the groups are listed. */
const KIND_GROUPS: readonly AccountProfile['kind'][] = ['codex', 'opencode-go', 'commandcode']

/** What connects a keyed account, for the notice the rail shows after creating one. */
const keyHintFor = (kind: AccountProfile['kind']): string =>
  kind === 'commandcode'
    ? 'Set COMMANDCODE_API_KEY in the environment and the picker publishes the route.'
    : 'Set OPENCODE_API_KEY (or a shared key on the ai-accounts entry) and the route serves.'

const STATE_LABEL: Record<AccountProfile['state'], string> = {
  healthy: 'Authenticated',
  cooling: 'Rate limited',
  disabled: 'Off',
  unconfigured: 'Not signed in',
}

const DISTRIBUTIONS: readonly AccountsFile['distribution'][] = ['sticky', 'priority', 'round-robin', 'balanced']

const DISTRIBUTION_HINT: Record<AccountsFile['distribution'], string> = {
  sticky: 'One account per conversation, so the upstream prompt cache stays warm. A rate-limited account is skipped and the retry lands on the next one.',
  priority: 'Drain one account until it is rate-limited, then the next in order.',
  'round-robin': 'Rotate on every request so spend spreads evenly.',
  balanced: 'Weighted random, biased toward the least recently used account.',
}

/** The section a route slug is valid under, so the field explains its own rule. */
const SLUG_HINT = 'Letters, digits, dash and underscore. Appears as the provider in the model picker.'

/** A blank account of the requested kind, with the shared Codex home default. */
const blankAccount = (kind: AccountProfile['kind']): AccountDraft => ({
  instanceId: '',
  kind,
  displayName: '',
  enabled: true,
  homePath: '~/.codex',
  shadowHomePath: '',
  apiKeyEnv: '',
  apiBaseUrl: '',
  badge: '',
  accentColor: '#2563EB',
  providerIcon: PROVIDER_ICONS[0],
  additionalModelIds: [],
  reasoningDefaults: {},
  hiddenModelIds: [],
  favoriteModelIds: [],
  modelOrder: [],
})

const sameDraft = (profile: AccountProfile, draft: AccountDraft): boolean =>
  profile.instanceId === draft.instanceId &&
  profile.kind === draft.kind &&
  profile.displayName === draft.displayName &&
  profile.enabled === draft.enabled &&
  profile.homePath === draft.homePath &&
  profile.shadowHomePath === draft.shadowHomePath &&
  profile.apiKeyEnv === draft.apiKeyEnv &&
  profile.apiBaseUrl === draft.apiBaseUrl &&
  profile.badge === draft.badge &&
  profile.accentColor === draft.accentColor &&
  profile.providerIcon === draft.providerIcon &&
  profile.additionalModelIds.join() === draft.additionalModelIds.join()

/** Up to three initials, the same tag the reference page derives by default. */
const badgeFromName = (displayName: string): string =>
  displayName
    .split(/\s+/u)
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 3)
    .toUpperCase()

const Field = (props: { readonly label: string; readonly hint?: string; readonly children: JSX.Element }): JSX.Element => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{props.label}</span>
    {props.children}
    {props.hint === undefined ? null : <span className={styles.fieldHint}>{props.hint}</span>}
  </label>
)

/** Percent remaining, coloured by how much is left rather than by provider. */
const remainingTone = (percent: number): string => (percent <= 10 ? String(styles.barCritical) : percent <= 30 ? String(styles.barLow) : String(styles.barOk))

const formatReset = (resetsAt: number | null): string | null => {
  if (resetsAt === null || Number.isNaN(resetsAt)) return null
  const minutes = Math.max(0, Math.round((resetsAt - Date.now()) / 60_000))
  if (minutes < 60) return `Resets in ${String(minutes)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `Resets in ${String(hours)}h`
  return `Resets in ${String(Math.round(hours / 24))}d`
}

const UsageCardView = (props: { readonly usage: UsageCard | undefined }): JSX.Element | null => {
  const usage = props.usage
  if (usage === undefined || usage.status !== 'ok' || usage.windows.length === 0) return null
  return (
    <div className={styles.usageCard}>
      {usage.windows.map(window => (
        <div className={styles.usageWindow} key={window.label}>
          <div className={styles.usageRow}>
            <span className={styles.usageLabel}>{window.label}</span>
            <span className={styles.usagePercent}>{window.percentRemaining}% left</span>
          </div>
          <div className={styles.usageTrack}>
            <div
              className={`${styles.usageBar} ${remainingTone(window.percentRemaining)}`}
              style={{ width: `${String(Math.max(0, Math.min(100, window.percentRemaining)))}%` }}
            />
          </div>
          {formatReset(window.resetsAt) === null ? null : <div className={styles.usageReset}>{formatReset(window.resetsAt)}</div>}
        </div>
      ))}
      {usage.bankedResets > 0 ? (
        <div className={styles.usageBanked}>
          {String(usage.bankedResets)} banked reset{usage.bankedResets === 1 ? '' : 's'}
          {usage.bankedResetExpiries
            .filter((expiresAt): expiresAt is number => expiresAt !== null)
            .sort((left, right) => left - right)
            .map(expiresAt => ` · earliest expires ${new Date(expiresAt).toLocaleDateString()}`)
            .join('')}
        </div>
      ) : null}
    </div>
  )
}

/** One numbered section header, the shape the reference page numbers 01–05. */
const Section = (props: {
  readonly index: string
  readonly title: string
  readonly action?: JSX.Element | null
  readonly muted?: string
  readonly children: ReactNode
}): JSX.Element => (
  <section className={styles.section}>
    <div className={styles.sectionHead}>
      <div className={styles.sectionHeadTitle}>
        <span className={styles.sectionIndex}>{props.index}</span>
        <h3>{props.title}</h3>
      </div>
      {props.action ?? null}
      {props.muted === undefined ? null : <span className={styles.sectionMuted}>{props.muted}</span>}
    </div>
    <p className={styles.help}>{props.children}</p>
  </section>
)

/**
 * Quota over time for one account.
 *
 * Drawn as an inline sparkline per window rather than a charting library: the
 * shape is one polyline per labelled window over a fixed time axis, which is
 * enough to answer "is it draining faster than it resets" without shipping a
 * dependency or a canvas the theme cannot restyle.
 */
const UsageHistoryChart = (props: {
  readonly points: readonly { at: number; windows: Record<string, number> }[] | undefined
  readonly days: number
}): JSX.Element => {
  const points = props.points ?? []
  if (points.length < 2) {
    return <p className={styles.historyEmpty}>Not enough history yet. Quota is recorded on an interval; check back shortly.</p>
  }
  const labels = [...new Set(points.flatMap(point => Object.keys(point.windows)))]
  const from = points[0]?.at ?? Date.now()
  const span = Math.max(1, Date.now() - from)
  const width = 100
  const height = 24
  return (
    <div className={styles.history}>
      {labels.map(label => {
        const line = points
          .filter(point => point.windows[label] !== undefined)
          .map(point => {
            const x = ((point.at - from) / span) * width
            const remaining = point.windows[label] ?? 0
            const y = height - (Math.max(0, Math.min(100, remaining)) / 100) * height
            return `${x.toFixed(2)},${y.toFixed(2)}`
          })
          .join(' ')
        return (
          <div className={styles.historyRow} key={label}>
            <span className={styles.historyLabel}>{label}</span>
            <svg
              className={styles.historySvg}
              viewBox={`0 0 ${String(width)} ${String(height)}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`${label} remaining over the last ${String(props.days)} days`}
            >
              <polyline className={styles.historyLine} points={line} />
            </svg>
          </div>
        )
      })}
      <div className={styles.historyAxis}>
        <span>{props.days}d ago</span>
        <span>now</span>
      </div>
    </div>
  )
}

/**
 * Model curation: favorite, hide, and reorder an account's models.
 *
 * Reordering is explicit rather than a full sort, so a model the provider adds
 * later appears after the curated ones instead of displacing them. The rows are
 * split into Favorites, All, and Hidden groups so a long catalog stays readable.
 */
const ModelCuration = (props: {
  readonly account: AccountDraft
  readonly catalog: readonly { id: string; name: string; efforts: readonly { id: string; name: string }[]; defaultEffort: string | null }[]
  readonly onChange: (next: Partial<AccountDraft>) => void
}): JSX.Element => {
  const { hiddenModelIds, favoriteModelIds, modelOrder, reasoningDefaults } = props.account
  const listed = modelOrder.filter(id => props.catalog.some(model => model.id === id))
  const ordered = [
    ...listed.map(id => props.catalog.find(model => model.id === id)).filter(model => model !== undefined),
    ...props.catalog.filter(model => !listed.includes(model.id)),
  ]
  const hidden = new Set(hiddenModelIds)
  const favorites = new Set(favoriteModelIds)
  const favoriteModels = ordered.filter(model => favorites.has(model.id) && !hidden.has(model.id))
  const availableModels = ordered.filter(model => !hidden.has(model.id) && !favorites.has(model.id))
  const hiddenModels = ordered.filter(model => hidden.has(model.id))
  const allHidden = ordered.length > 0 && ordered.every(model => hidden.has(model.id))

  const move = (id: string, delta: number) => {
    const next = ordered.map(model => model.id)
    const index = next.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= next.length) return
    const [moved] = next.splice(index, 1)
    if (moved === undefined) return
    next.splice(target, 0, moved)
    props.onChange({ modelOrder: next })
  }

  const toggleFavorite = (modelId: string) => {
    const nextFavorites = new Set(favoriteModelIds)
    if (nextFavorites.has(modelId)) nextFavorites.delete(modelId)
    else nextFavorites.add(modelId)
    const favoritesFirst = ordered.filter(model => nextFavorites.has(model.id)).map(model => model.id)
    const rest = ordered.filter(model => !nextFavorites.has(model.id)).map(model => model.id)
    props.onChange({ favoriteModelIds: [...nextFavorites], modelOrder: [...favoritesFirst, ...rest] })
  }

  const toggleHidden = (modelId: string) => {
    const next = new Set(hiddenModelIds)
    if (next.has(modelId)) next.delete(modelId)
    else next.add(modelId)
    props.onChange({ hiddenModelIds: [...next] })
  }

  const setEffort = (modelId: string, effortId: string) => {
    const next = { ...reasoningDefaults }
    if (effortId === '') delete next[modelId]
    else next[modelId] = effortId
    props.onChange({ reasoningDefaults: next })
  }

  const rows = (models: readonly { id: string; name: string; efforts: readonly { id: string; name: string }[]; defaultEffort: string | null }[]) =>
    models.map(model => {
      const isFavorite = favorites.has(model.id)
      const isHidden = hidden.has(model.id)
      const groupIndex = models.findIndex(candidate => candidate.id === model.id)
      return (
        <li className={isHidden ? `${styles.modelRow} ${styles.modelRowHidden}` : styles.modelRow} key={model.id}>
          <button
            type="button"
            className={isFavorite ? styles.starOn : styles.starOff}
            aria-label={isFavorite ? `Unstar ${model.name}` : `Star ${model.name}`}
            aria-pressed={isFavorite}
            onClick={() => toggleFavorite(model.id)}
          >
            ★
          </button>
          <span className={styles.modelName} title={model.id}>
            <strong>{model.name}</strong>
            <small>{model.id}</small>
          </span>
          <span className={styles.modelActions}>
            {model.efforts.length === 0 ? null : (
              <select
                className={styles.reasoningSelect}
                aria-label={`Default reasoning effort for ${model.name}`}
                value={reasoningDefaults[model.id] ?? model.defaultEffort ?? ''}
                onChange={event => setEffort(model.id, event.target.value)}
              >
                {model.defaultEffort === null || reasoningDefaults[model.id] !== undefined ? null : <option value="">Provider default</option>}
                {model.efforts.map(effort => (
                  <option key={effort.id} value={effort.id}>
                    {effort.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className={styles.moveButton}
              aria-label={`Move ${model.name} up`}
              disabled={groupIndex === 0}
              onClick={() => move(model.id, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className={styles.moveButton}
              aria-label={`Move ${model.name} down`}
              disabled={groupIndex === models.length - 1}
              onClick={() => move(model.id, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className={styles.moveButton}
              aria-pressed={!isHidden}
              aria-label={isHidden ? `Show ${model.name} in the picker` : `Hide ${model.name} from the picker`}
              onClick={() => toggleHidden(model.id)}
            >
              {isHidden ? 'Show' : 'Hide'}
            </button>
          </span>
        </li>
      )
    })

  const toggleAll = () => {
    if (allHidden) {
      props.onChange({ hiddenModelIds: hiddenModelIds.filter(id => !props.catalog.some(model => model.id === id)) })
      return
    }
    props.onChange({ hiddenModelIds: [...new Set([...hiddenModelIds, ...ordered.map(model => model.id)])] })
  }

  return (
    <div className={styles.curation}>
      <div className={styles.modelToolbar}>
        <button type="button" className={styles.quiet} onClick={toggleAll}>
          {allHidden ? 'Enable all' : 'Disable all'}
        </button>
        <span className={styles.modelCount}>
          {ordered.length} models · {favoriteModels.length} favorites · {hiddenModels.length} hidden
        </span>
      </div>
      {ordered.length === 0 ? <p className={styles.empty}>No models returned yet. Sign in, then refresh the provider catalog.</p> : null}
      {favoriteModels.length > 0 ? (
        <>
          <h4 className={styles.modelGroup}>Favorites</h4>
          <ul className={styles.modelList}>{rows(favoriteModels)}</ul>
        </>
      ) : null}
      {availableModels.length > 0 ? (
        <>
          <h4 className={styles.modelGroup}>All</h4>
          <ul className={styles.modelList}>{rows(availableModels)}</ul>
        </>
      ) : null}
      {hiddenModels.length > 0 ? (
        <>
          <h4 className={styles.modelGroup}>Hidden from picker</h4>
          <ul className={styles.modelList}>{rows(hiddenModels)}</ul>
        </>
      ) : null}
    </div>
  )
}

/** One group of the rail: a provider heading and the accounts under it. */
const AccountGroup = (props: {
  readonly kind: AccountProfile['kind']
  readonly accounts: readonly AccountProfile[]
  readonly selectedId: string | null
  readonly onSelect: (instanceId: string) => void
  readonly onToggle: (profile: AccountProfile) => void
}): JSX.Element | null => {
  if (props.accounts.length === 0) return null
  return (
    <section className={styles.group}>
      <h2>{KIND_LABEL[props.kind].toUpperCase()}</h2>
      {props.accounts.map(profile => (
        <div
          className={profile.instanceId === props.selectedId ? `${styles.accountRow} ${styles.accountRowSelected}` : styles.accountRow}
          key={profile.instanceId}
        >
          <button
            type="button"
            className={styles.accountSelect}
            aria-current={profile.instanceId === props.selectedId ? 'true' : undefined}
            onClick={() => props.onSelect(profile.instanceId)}
          >
            <span className={styles.mark} style={{ background: profile.accentColor === '' ? undefined : profile.accentColor }} aria-hidden>
              {profile.badge === '' ? badgeFromName(profile.displayName).slice(0, 2) : profile.badge}
            </span>
            <span className={styles.accountCopy}>
              <strong>{profile.displayName}</strong>
              <small>{profile.identity ?? STATE_LABEL[profile.state]}</small>
            </span>
          </button>
          <label className={styles.accountToggle} title={profile.enabled ? 'Hide from the model picker' : 'Show in the model picker'}>
            <input
              type="checkbox"
              aria-label={`${profile.enabled ? 'Hide' : 'Show'} ${profile.displayName} in the model picker`}
              checked={profile.enabled}
              onChange={event => props.onToggle({ ...profile, enabled: event.target.checked })}
            />
            <span className={styles.switchTrack}>
              <span className={profile.enabled ? styles.knobOn : styles.knobOff} />
            </span>
          </label>
        </div>
      ))}
    </section>
  )
}

export const AccountsPanel = (props: { readonly onOpenUsageHistory: () => void }): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const [usage, setUsage] = useState<AccountsUsage | null>(null)
  const [catalog, setCatalog] = useState<AccountsCatalog | null>(null)
  const [refreshingCatalog, setRefreshingCatalog] = useState(false)
  const [history, setHistory] = useState<readonly { at: number; windows: Record<string, number> }[]>([])
  const [historyDays, setHistoryDays] = useState(7)
  const [file, setFile] = useState<AccountsFile | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AccountDraft | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [overlays, setOverlays] = useState<OverlaySettings>(() => ({ edgeWidget: true, footerQuota: true }))

  const load = useCallback(async () => {
    const next = await accounts.read()
    setFile(next)
    setSelectedId(current => current ?? next.accounts[0]?.instanceId ?? null)
  }, [accounts])

  useEffect(() => {
    void load().catch(() => setNotice('The account host did not answer.'))
  }, [load])

  // Surfaces are independent of the file, so read them once on open.
  useEffect(() => {
    void accounts
      .overlaySettings()
      .then(setOverlays)
      .catch(() => setOverlays({ edgeWidget: true, footerQuota: true }))
  }, [accounts])

  const persistOverlay = async (patch: Partial<OverlaySettings>) => {
    setOverlays(await accounts.saveOverlaySettings({ patch }))
  }

  // The catalog is per account and only changes when the account does.
  const refreshCatalog = useCallback(
    async (instanceId: string): Promise<void> => {
      setRefreshingCatalog(true)
      try {
        setCatalog(await accounts.catalog({ instanceId }))
      } catch {
        setCatalog(null)
      } finally {
        setRefreshingCatalog(false)
      }
    },
    [accounts],
  )

  useEffect(() => {
    if (selectedId === null) {
      setCatalog(null)
      return
    }
    void refreshCatalog(selectedId)
  }, [selectedId, refreshCatalog])

  // History is read alongside the catalog, and a manual collect fills it in
  // immediately rather than waiting for the next scheduled sweep.
  useEffect(() => {
    if (selectedId === null) {
      setHistory([])
      return
    }
    void accounts
      .history({ instanceId: selectedId, days: historyDays })
      .then(result => setHistory(result.points))
      .catch(() => setHistory([]))
  }, [accounts, selectedId, historyDays, usage])

  // Quota moves on its own, so refresh on an interval rather than per render.
  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void accounts
        .usage()
        .then(next => {
          if (!cancelled) setUsage(next)
        })
        .catch(() => undefined)
    }
    refresh()
    const timer = setInterval(refresh, 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [accounts])

  const selected = useMemo(() => file?.accounts.find(account => account.instanceId === selectedId) ?? null, [file, selectedId])

  // The editor follows the selection, and keeps unsaved edits across re-reads.
  useEffect(() => {
    if (selected === null) {
      setDraft(null)
      return
    }
    setDraft(current => (current !== null && current.instanceId === selected.instanceId && !sameDraft(selected, current) ? current : { ...selected }))
  }, [selected])

  const dirty = selected !== null && draft !== null && !sameDraft(selected, draft)

  const save = async (next: AccountDraft) => {
    setSaving(true)
    setNotice(null)
    try {
      setFile(await accounts.save({ draft: next }))
      setSelectedId(next.instanceId)
      setNotice('Saved. New sessions use the updated route settings.')
    } catch (error) {
      setNotice(`Could not save: ${String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  /** Write straight through, for the toggles the reference page saves on click. */
  const persist = async (patch: Partial<AccountDraft>) => {
    if (selected === null) return
    const next = { ...selected, ...patch }
    setDraft(next)
    try {
      setFile(await accounts.save({ draft: next }))
    } catch (error) {
      setNotice(`Could not save: ${String(error)}`)
      setDraft(selected)
    }
  }

  const toggleEnabled = async (profile: AccountProfile) => {
    setFile(await accounts.save({ draft: { ...profile, enabled: !profile.enabled } }))
  }

  const remove = async (profile: AccountProfile) => {
    setFile(await accounts.remove({ instanceId: profile.instanceId }))
    setSelectedId(current => (current === profile.instanceId ? null : current))
    setNotice(`Removed ${profile.displayName}. Credentials were left on disk.`)
  }

  /**
   * One click, one account. The kind decides every default: a unique route slug,
   * a display name, a two-character tag, a color and a spare icon — all editable
   * after the fact in the numbered sections. The user signs in afterwards; the
   * panel polls the identity and the card lights up when Codex writes the file.
   */
  const createAccount = async (kind: AccountProfile['kind']) => {
    setAddMenuOpen(false)
    setSaving(true)
    setNotice(null)
    try {
      const existing = file?.accounts ?? []
      const taken = new Set(existing.map(account => account.instanceId))
      const base = blankAccount(kind)
      let derived = `${kind}_work`
      for (let suffix = 2; taken.has(derived); suffix += 1) derived = `${kind}_work_${suffix}`
      const ordinalLabel = `${KIND_LABEL[kind]} ${existing.filter(account => account.kind === kind).length + 1}`
      const freeIcon = PROVIDER_ICONS.find(icon => !existing.some(account => account.providerIcon === icon)) ?? PROVIDER_ICONS[0]
      const draft: AccountDraft = {
        ...base,
        instanceId: derived,
        displayName: ordinalLabel,
        badge: badgeFromName(ordinalLabel),
        accentColor: kind === 'codex' ? '#2563EB' : kind === 'opencode-go' ? '#7C3AED' : '#0E7490',
        providerIcon: freeIcon,
      }
      setFile(await accounts.save({ draft }))
      setSelectedId(derived)
      const label = kind === 'codex' ? 'Sign in with the copied command (Session section) and the identity fills itself in.' : keyHintFor(kind)
      setNotice(`Added ${ordinalLabel}. ${label}`)
    } catch (error) {
      setNotice(`Could not add the account: ${String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(message)
    } catch {
      setNotice(`Copy this into a terminal: ${text}`)
    }
  }

  /**
   * While an account has no login, poll for one: the user signs in with the
   * command shown, and the card refreshes as soon as Codex writes the file.
   */
  useEffect(() => {
    if (selected === null || selected.signedIn || selected.kind !== 'codex') return
    let cancelled = false
    const check = async () => {
      const identity = await accounts.identity({ instanceId: selected.instanceId })
      if (cancelled || !identity.signedIn) return
      setFile(await accounts.read())
    }
    const timer = setInterval(() => void check().catch(() => undefined), 2500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [accounts, selected])

  if (file === null) {
    return <div className={styles.notice}>{notice ?? 'Loading accounts…'}</div>
  }

  const kicker = draft?.kind === 'opencode-go' ? 'OPENCODE SUBSCRIPTION' : draft?.kind === 'commandcode' ? 'COMMAND CODE' : 'CHATGPT SUBSCRIPTION'

  const launchCommand =
    draft !== null && draft.kind === 'codex' && draft.shadowHomePath.trim() !== ''
      ? `CODEX_HOME='${draft.shadowHomePath.replaceAll("'", "'\\''")}' codex`
      : null

  return (
    <div className={styles.page}>
      <header className={styles.toolbar}>
        <span className={styles.scopeBar}>
          <span>Applying settings for</span>
          <span className={styles.scopeValue}>All accounts</span>
          <span>on</span>
          <span className={styles.scopeValue}>this host</span>
        </span>
        <label className={styles.overlaySwitch}>
          <input type="checkbox" checked={overlays.edgeWidget} onChange={event => void persistOverlay({ edgeWidget: event.target.checked })} />
          <span>Edge overlay</span>
        </label>
        <label className={styles.overlaySwitch}>
          <input type="checkbox" checked={overlays.footerQuota} onChange={event => void persistOverlay({ footerQuota: event.target.checked })} />
          <span>Sidebar foot</span>
        </label>
        <span className={styles.scopeBar}>
          <span>Spreading requests</span>
          <select
            className={styles.scopeSelect}
            value={file.distribution}
            aria-label="Request distribution"
            onChange={event => {
              const distribution = event.target.value as AccountsFile['distribution']
              void accounts
                .setDistribution({ distribution })
                .then(setFile)
                .catch(error => setNotice(`Could not change distribution: ${String(error)}`))
            }}
          >
            {DISTRIBUTIONS.map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </span>
      </header>

      <div className={styles.layout}>
        <aside className={styles.rail} aria-label="Provider accounts">
          <div className={styles.railHeading}>
            <span>
              YOUR ACCOUNTS <i className={styles.count}>{file.accounts.length}</i>
            </span>
            <span className={styles.addAnchor}>
              <button
                type="button"
                className={styles.addTrigger}
                aria-label="Add account"
                aria-expanded={addMenuOpen}
                onClick={() => setAddMenuOpen(current => !current)}
              >
                +
              </button>
              {addMenuOpen ? (
                <span className={styles.addMenu} role="menu">
                  {KIND_GROUPS.map(kind => (
                    <button type="button" role="menuitem" key={kind} disabled={saving} onClick={() => void createAccount(kind)}>
                      <span
                        className={styles.addMenuMark}
                        style={{ background: kind === 'codex' ? '#2563EB' : kind === 'opencode-go' ? '#7C3AED' : '#0E7490' }}
                        aria-hidden
                      >
                        {KIND_LABEL[kind].slice(0, 2).toUpperCase()}
                      </span>
                      {KIND_LABEL[kind]} account
                    </button>
                  ))}
                </span>
              ) : null}
            </span>
          </div>
          {file.accounts.length === 0 ? <p className={styles.empty}>Add an account to publish its own model route.</p> : null}
          {KIND_GROUPS.map(kind => (
            <AccountGroup
              kind={kind}
              accounts={file.accounts.filter(profile => profile.kind === kind)}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onToggle={profile => void toggleEnabled(profile)}
              key={kind}
            />
          ))}
          <p className={styles.railFoot}>Credentials stay in each provider&apos;s own account directory.</p>
        </aside>

        {draft !== null ? (
          <section className={styles.detail}>
            <div className={styles.detailTop}>
              <div className={styles.detailTitleBlock}>
                <span className={styles.markLarge} style={{ background: draft.accentColor === '' ? undefined : draft.accentColor }} aria-hidden>
                  {draft.badge === '' ? 'AI' : draft.badge}
                </span>
                <div>
                  <p className={styles.kicker}>{kicker}</p>
                  <h2>{draft.displayName || draft.instanceId}</h2>
                </div>
              </div>
              <label className={styles.switchLabel}>
                <span>{draft.enabled ? 'Enabled in model picker' : 'Hidden from model picker'}</span>
                <input type="checkbox" checked={draft.enabled} onChange={event => void persist({ enabled: event.target.checked })} />
                <span className={styles.switchTrack}>
                  <span className={draft.enabled ? styles.knobOn : styles.knobOff} />
                </span>
              </label>
            </div>

            <div className={styles.detailContent}>
              <Section
                index="01"
                title="Account identity"
                action={
                  <button
                    type="button"
                    className={styles.quiet}
                    disabled={draft.kind !== 'codex' || selectedId === null}
                    onClick={() => {
                      if (selectedId === null) return
                      void accounts
                        .identity({ instanceId: selectedId })
                        .then(identity => {
                          setNotice(identity.signedIn ? 'Codex account identity refreshed.' : 'No signed-in account was found at this home yet.')
                          if (identity.signedIn) void load()
                        })
                        .catch(() => setNotice('Could not read the Codex account identity.'))
                    }}
                  >
                    ↻ Refresh
                  </button>
                }
              >
                <div className={styles.fieldGrid}>
                  <Field label="Route slug" hint={SLUG_HINT}>
                    <input className={styles.input} value={draft.instanceId} onChange={event => setDraft({ ...draft, instanceId: event.target.value })} />
                  </Field>
                  <Field label="Display name">
                    <input
                      className={styles.input}
                      value={draft.displayName}
                      placeholder={KIND_LABEL[draft.kind]}
                      onChange={event => setDraft({ ...draft, displayName: event.target.value })}
                    />
                  </Field>
                  <Field label="Signed-in identity">
                    <input
                      className={styles.input}
                      readOnly
                      value={
                        selected?.identity ??
                        (draft.kind === 'codex' ? 'Sign in, then refresh' : `Key from ${draft.apiKeyEnv === '' ? 'the environment' : draft.apiKeyEnv}`)
                      }
                    />
                  </Field>
                  <Field label="Picker tag" hint="Up to 3 characters, shown on the provider mark.">
                    <input
                      className={styles.input}
                      value={draft.badge}
                      maxLength={3}
                      placeholder={badgeFromName(draft.displayName)}
                      onChange={event => setDraft({ ...draft, badge: event.target.value.toUpperCase() })}
                    />
                  </Field>
                  <Field label="Tag color">
                    <input
                      className={styles.colorInput}
                      type="color"
                      value={draft.accentColor}
                      onChange={event => setDraft({ ...draft, accentColor: event.target.value })}
                    />
                  </Field>
                  <Field label="Picker icon">
                    <select className={styles.input} value={draft.providerIcon} onChange={event => setDraft({ ...draft, providerIcon: event.target.value })}>
                      {PROVIDER_ICONS.map(icon => (
                        <option key={icon} value={icon}>
                          {icon}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </Section>

              <Section
                index="02"
                title="Runtime paths"
                muted="Absolute path on this host"
                action={
                  launchCommand === null ? null : (
                    <button
                      type="button"
                      className={styles.quiet}
                      onClick={() => void copy(launchCommand, 'Launch command copied. Run it in a terminal to open interactive Codex for this account.')}
                    >
                      Copy launch command
                    </button>
                  )
                }
              >
                <div className={styles.pathField}>
                  <span>
                    {draft.kind === 'codex' ? 'CODEX_HOME' : 'API KEY'}
                    <small>{draft.kind === 'codex' ? 'Shared sessions, skills and plugins.' : 'Named, never valued: the key stays in the environment.'}</small>
                  </span>
                  <input
                    className={styles.input}
                    aria-label={draft.kind === 'codex' ? 'CODEX_HOME' : 'API key environment variable'}
                    spellCheck={false}
                    value={draft.kind === 'codex' ? draft.homePath : draft.apiKeyEnv}
                    placeholder={draft.kind === 'codex' ? '~/.codex' : 'OPENCODE_API_KEY'}
                    onChange={event =>
                      setDraft(draft.kind === 'codex' ? { ...draft, homePath: event.target.value } : { ...draft, apiKeyEnv: event.target.value })
                    }
                  />
                </div>
                {draft.kind === 'codex' ? (
                  <div className={styles.pathField}>
                    <span>
                      Shadow home
                      <small>Per-account home keeping auth.json separate while sharing state.</small>
                    </span>
                    <input
                      className={styles.input}
                      aria-label="Shadow home path"
                      spellCheck={false}
                      value={draft.shadowHomePath}
                      placeholder="Leave empty for one under the shadow root"
                      onChange={event => setDraft({ ...draft, shadowHomePath: event.target.value })}
                    />
                  </div>
                ) : null}
                {draft.kind === 'commandcode' ? (
                  <div className={styles.pathField}>
                    <span>
                      API base URL
                      <small>Leave empty for Command Code&apos;s own deployment.</small>
                    </span>
                    <input
                      className={styles.input}
                      aria-label="API base URL"
                      spellCheck={false}
                      value={draft.apiBaseUrl}
                      placeholder="https://api.commandcode.ai"
                      onChange={event => setDraft({ ...draft, apiBaseUrl: event.target.value })}
                    />
                  </div>
                ) : null}
              </Section>

              <Section
                index="03"
                title="Models"
                action={
                  <button
                    type="button"
                    className={styles.quiet}
                    disabled={refreshingCatalog}
                    onClick={() => {
                      if (draft.instanceId === '') return
                      void refreshCatalog(draft.instanceId)
                    }}
                  >
                    {refreshingCatalog ? 'Checking…' : '↻ Check now'}
                  </button>
                }
              >
                <span className={styles.sectionHelp}>
                  Show or hide models in the picker, star the ones you reach for, and pin a default reasoning effort per model.
                </span>
                <ModelCuration account={draft} catalog={catalog?.models ?? []} onChange={next => setDraft({ ...draft, ...next })} />
              </Section>

              <Section
                index="04"
                title="Quota"
                action={
                  <span className={styles.sectionActions}>
                    <select
                      className={styles.rangeSelect}
                      value={String(historyDays)}
                      aria-label="History range"
                      onChange={event => setHistoryDays(Number(event.target.value))}
                    >
                      {[1, 3, 7, 14, 30].map(days => (
                        <option key={days} value={String(days)}>
                          {days}d
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={styles.quiet}
                      onClick={() => {
                        if (selectedId === null) return
                        void accounts
                          .collectUsage()
                          .then(() => accounts.history({ instanceId: selectedId, days: historyDays }))
                          .then(result => setHistory(result.points))
                          .catch(() => setNotice('Could not record usage right now.'))
                      }}
                    >
                      Record now
                    </button>
                  </span>
                }
              >
                <UsageCardView usage={usage?.cards.find(card => card.instanceId === selected?.instanceId)?.usage} />
                <UsageHistoryChart points={history} days={historyDays} />
              </Section>

              <Section
                index="05"
                title="Session"
                action={
                  selected === null || selected.signedIn ? null : (
                    <button type="button" className={styles.quiet} onClick={() => void copy(selected.loginHint, 'Sign-in command copied.')}>
                      ↗ Copy sign-in command
                    </button>
                  )
                }
              >
                <div className={styles.factGrid}>
                  <div>
                    <span className={styles.factLabel}>Route</span>
                    <span className={styles.factValue}>{draft.instanceId}</span>
                  </div>
                  <div>
                    <span className={styles.factLabel}>Mode</span>
                    <span className={styles.factValue}>
                      {draft.kind === 'codex' ? (draft.shadowHomePath === '' ? 'Shared auth' : 'Shared state, private auth') : 'Key from the environment'}
                    </span>
                  </div>
                  <div>
                    <span className={styles.factLabel}>Account</span>
                    <span className={styles.factValue}>{selected?.identity ?? STATE_LABEL[selected?.state ?? 'unconfigured']}</span>
                  </div>
                </div>
                <p className={styles.spreadingNote}>
                  Requests spread by <strong>{file.distribution}</strong>. {DISTRIBUTION_HINT[file.distribution]}
                </p>
                {selected !== null && !selected.signedIn ? (
                  <div className={styles.loginHint}>
                    <span>Sign in with</span>
                    <code>{selected.loginHint}</code>
                  </div>
                ) : null}
                {selected?.detail == null ? null : <p className={styles.warnText}>{selected.detail}</p>}
              </Section>
            </div>

            <footer className={styles.footer}>
              <button
                type="button"
                className={styles.primary}
                disabled={!dirty || saving || draft.instanceId.trim().length === 0}
                onClick={() => void save(draft)}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" className={styles.quiet} disabled={!dirty} onClick={() => setDraft(selected === null ? null : { ...selected })}>
                Revert
              </button>
              <button type="button" className={styles.quiet} onClick={props.onOpenUsageHistory}>
                Usage history
              </button>
              <span className={styles.footerNotice}>
                {notice ?? (dirty ? 'Unsaved changes.' : 'Provider and account are separate entries in the model picker.')}
              </span>
              <button type="button" className={styles.danger} onClick={() => selected !== null && void remove(selected)}>
                Remove profile
              </button>
            </footer>
          </section>
        ) : (
          <section className={styles.welcome}>
            <span className={styles.welcomeMark} aria-hidden>
              ✳
            </span>
            <h2>Your accounts, side by side.</h2>
            <p>Create a Codex, OpenCode Go, or Command Code profile. Each one becomes its own route in the model picker.</p>
          </section>
        )}
      </div>
    </div>
  )
}
