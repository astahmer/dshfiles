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
} from './api.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styles from './accounts.module.css'

/**
 * The accounts panel, in the shape of the reference account page: a list of
 * toggleable providers on one side, the selected provider's editable settings
 * on the other.
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

const STATE_LABEL: Record<AccountProfile['state'], string> = {
  healthy: 'Authenticated',
  cooling: 'Rate limited',
  disabled: 'Off',
  unconfigured: 'Not signed in',
}

const DISTRIBUTIONS: readonly AccountsFile['distribution'][] = [
  'sticky',
  'priority',
  'round-robin',
  'balanced',
]

const DISTRIBUTION_HINT: Record<AccountsFile['distribution'], string> = {
  sticky: 'One account per conversation, so the upstream prompt cache stays warm. A rate-limited account is skipped and the retry lands on the next one.',
  priority: 'Drain one account until it is rate-limited, then the next in order.',
  'round-robin': 'Rotate on every request so spend spreads evenly.',
  balanced: 'Weighted random, biased toward the least recently used account.',
}

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
  profile.instanceId === draft.instanceId
  && profile.kind === draft.kind
  && profile.displayName === draft.displayName
  && profile.enabled === draft.enabled
  && profile.homePath === draft.homePath
  && profile.shadowHomePath === draft.shadowHomePath
  && profile.apiKeyEnv === draft.apiKeyEnv
  && profile.badge === draft.badge
  && profile.accentColor === draft.accentColor
  && profile.providerIcon === draft.providerIcon
  && profile.additionalModelIds.join() === draft.additionalModelIds.join()

const Field = (props: {
  readonly label: string
  readonly hint?: string
  readonly children: JSX.Element
}): JSX.Element => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{props.label}</span>
    {props.children}
    {props.hint === undefined ? null : <span className={styles.fieldHint}>{props.hint}</span>}
  </label>
)


/** Percent remaining, coloured by how much is left rather than by provider. */
const remainingTone = (percent: number): string =>
  percent <= 10
    ? String(styles.barCritical)
    : percent <= 30
      ? String(styles.barLow)
      : String(styles.barOk)

const formatReset = (resetsAt: number | null): string | null => {
  if (resetsAt === null || Number.isNaN(resetsAt)) return null
  const minutes = Math.max(0, Math.round((resetsAt - Date.now()) / 60_000))
  if (minutes < 60) return `Resets in ${String(minutes)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `Resets in ${String(hours)}h`
  return `Resets in ${String(Math.round(hours / 24))}d`
}

const UsageCardView = (props: {
  readonly usage: UsageCard | undefined
}): JSX.Element | null => {
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
          {formatReset(window.resetsAt) === null ? null : (
            <div className={styles.usageReset}>{formatReset(window.resetsAt)}</div>
          )}
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


/**
 * Per-model default reasoning effort.
 *
 * Only models that actually offer levels are listed, and the provider's own
 * default is the first option, so pinning is an override rather than a
 * requirement.
 */
const ReasoningDefaults = (props: {
  readonly account: AccountDraft
  readonly catalog: readonly { id: string; name: string; efforts: readonly { id: string; name: string }[]; defaultEffort: string | null }[] | undefined
  readonly onChange: (defaults: Record<string, string>) => void
}): JSX.Element | null => {
  const catalog = (props.catalog ?? []).filter(model => model.efforts.length > 0)
  if (catalog.length === 0) return null
  const pins = props.account.reasoningDefaults
  return (
    <div className={styles.reasoning}>
      <span className={styles.fieldLabel}>Default reasoning effort</span>
      <span className={styles.fieldHint}>
        Applied when a request does not choose one. Models not listed keep the provider default.
      </span>
      {catalog.map(model => (
        <div className={styles.reasoningRow} key={model.id}>
          <span className={styles.reasoningModel} title={model.id}>
            {model.name}
          </span>
          <select
            className={styles.input}
            value={pins[model.id] ?? ''}
            onChange={event => {
              const next = { ...pins }
              if (event.target.value === '') delete next[model.id]
              else next[model.id] = event.target.value
              props.onChange(next)
            }}
          >
            <option value="">
              {model.defaultEffort === null
                ? 'Provider default'
                : `Provider default (${model.defaultEffort})`}
            </option>
            {model.efforts.map(effort => (
              <option key={effort.id} value={effort.id}>
                {effort.name}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}


/**
 * Model curation: hide, favorite, and reorder an account's models.
 *
 * Reordering is explicit rather than a full sort, so a model the provider adds
 * later appears after the curated ones instead of displacing them.
 */
const ModelCuration = (props: {
  readonly account: AccountDraft
  readonly catalog: readonly { id: string; name: string }[] | undefined
  readonly onChange: (next: Partial<AccountDraft>) => void
}): JSX.Element | null => {
  const catalog = props.catalog ?? []
  if (catalog.length === 0) return null
  const { hiddenModelIds, favoriteModelIds, modelOrder } = props.account
  const listed = modelOrder.filter(id => catalog.some(model => model.id === id))
  const ordered = [
    ...listed,
    ...catalog.filter(model => !listed.includes(model.id)).map(model => model.id),
  ]
  const move = (id: string, delta: number) => {
    const index = ordered.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= ordered.length) return
    const next = [...ordered]
    const [moved] = next.splice(index, 1)
    if (moved === undefined) return
    next.splice(target, 0, moved)
    props.onChange({ modelOrder: next })
  }
  return (
    <div className={styles.curation}>
      <span className={styles.fieldLabel}>Models</span>
      <span className={styles.fieldHint}>
        Starred models appear first, hidden ones drop out of the picker entirely.
      </span>
      <ul className={styles.modelList}>
        {ordered.map((id, index) => {
          const model = catalog.find(candidate => candidate.id === id)
          const hidden = hiddenModelIds.includes(id)
          const favorite = favoriteModelIds.includes(id)
          return (
            <li className={styles.modelRow} key={id}>
              <button
                type="button"
                className={favorite ? styles.starOn : styles.starOff}
                aria-label={favorite ? `Unstar ${model?.name ?? id}` : `Star ${model?.name ?? id}`}
                aria-pressed={favorite}
                onClick={() =>
                  props.onChange({
                    favoriteModelIds: favorite
                      ? favoriteModelIds.filter(candidate => candidate !== id)
                      : [...favoriteModelIds, id],
                  })
                }
              >
                ★
              </button>
              <span className={hidden ? styles.modelHidden : styles.modelName} title={id}>
                {model?.name ?? id}
              </span>
              <button
                type="button"
                className={styles.moveButton}
                aria-label={`Move ${model?.name ?? id} up`}
                disabled={index === 0}
                onClick={() => move(id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.moveButton}
                aria-label={`Move ${model?.name ?? id} down`}
                disabled={index === ordered.length - 1}
                onClick={() => move(id, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className={styles.moveButton}
                aria-label={hidden ? `Show ${model?.name ?? id}` : `Hide ${model?.name ?? id}`}
                aria-pressed={!hidden}
                onClick={() =>
                  props.onChange({
                    hiddenModelIds: hidden
                      ? hiddenModelIds.filter(candidate => candidate !== id)
                      : [...hiddenModelIds, id],
                  })
                }
              >
                {hidden ? 'Show' : 'Hide'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}


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
    return (
      <p className={styles.historyEmpty}>
        Not enough history yet. Quota is recorded every 15 minutes; check back shortly.
      </p>
    )
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

export const AccountsPanel = (): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const [usage, setUsage] = useState<AccountsUsage | null>(null)
  const [catalog, setCatalog] = useState<AccountsCatalog | null>(null)
  const [history, setHistory] = useState<readonly { at: number; windows: Record<string, number> }[]>([])
  const [historyDays, setHistoryDays] = useState(7)
  const [file, setFile] = useState<AccountsFile | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AccountDraft | null>(null)
  const [addingKind, setAddingKind] = useState<AccountProfile['kind'] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const next = await accounts.read()
    setFile(next)
    setSelectedId(current => current ?? next.accounts[0]?.instanceId ?? null)
  }, [accounts])

  useEffect(() => {
    void load().catch(() => setNotice('The account host did not answer.'))
  }, [load])

  // The catalog is per account and only changes when the account does.
  useEffect(() => {
    if (selectedId === null) {
      setCatalog(null)
      return
    }
    void accounts
      .catalog({ instanceId: selectedId })
      .then(setCatalog)
      .catch(() => setCatalog(null))
  }, [accounts, selectedId])

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

  const selected = useMemo(
    () => file?.accounts.find(account => account.instanceId === selectedId) ?? null,
    [file, selectedId],
  )

  // The editor follows the selection, and keeps unsaved edits across re-reads.
  useEffect(() => {
    if (selected === null) {
      setDraft(null)
      return
    }
    setDraft(current =>
      current !== null && current.instanceId === selected.instanceId && !sameDraft(selected, current)
        ? current
        : { ...selected },
    )
  }, [selected])

  const dirty = selected !== null && draft !== null && !sameDraft(selected, draft)

  const save = async (next: AccountDraft) => {
    setSaving(true)
    setNotice(null)
    try {
      setFile(await accounts.save({ draft: next }))
      setSelectedId(next.instanceId)
      setNotice(`Saved ${next.instanceId}.`)
    } catch (error) {
      setNotice(`Could not save: ${String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (profile: AccountProfile) => {
    setFile(await accounts.save({ draft: { ...profile, enabled: !profile.enabled } }))
  }

  const remove = async (profile: AccountProfile) => {
    setFile(await accounts.remove({ instanceId: profile.instanceId }))
    setSelectedId(current => (current === profile.instanceId ? null : current))
    setNotice(`Removed ${profile.instanceId}.`)
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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>AI Accounts</h1>
          <p className={styles.subtitle}>
            Each account is its own model route. Editing a profile here updates the picker;
            credentials stay in each provider&apos;s own home.
          </p>
        </div>
        <div className={styles.headerActions}>
          <select
            className={styles.distribution}
            value={file.distribution}
            onChange={event => {
              const distribution = event.target.value as AccountsFile['distribution']
              void accounts
                .setDistribution({ distribution })
                .then(setFile)
                .catch(error => setNotice(`Could not change distribution: ${String(error)}`))
            }}
            aria-label="Request distribution"
          >
            {DISTRIBUTIONS.map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setAddingKind('codex')}
          >
            + Codex
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setAddingKind('opencode-go')}
          >
            + OpenCode
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setAddingKind('commandcode')}
          >
            + Command Code
          </button>
        </div>
      </header>

      <p className={styles.distributionHint}>{DISTRIBUTION_HINT[file.distribution]}</p>
      {notice === null ? null : <p className={styles.notice}>{notice}</p>}

      <div className={styles.split}>
        <div className={styles.list}>
          {file.accounts.length === 0 ? (
            <p className={styles.empty}>No accounts yet. Add one to publish its model route.</p>
          ) : null}
          {file.accounts.map(profile => (
            <button
              type="button"
              key={profile.instanceId}
              className={
                profile.instanceId === selectedId
                  ? `${styles.card} ${styles.cardSelected}`
                  : styles.card
              }
              onClick={() => setSelectedId(profile.instanceId)}
            >
              <span
                className={styles.cardGlyph}
                style={{ background: profile.accentColor === '' ? undefined : profile.accentColor }}
                aria-hidden
              >
                {profile.providerIcon.slice(0, 2).toUpperCase()}
              </span>
              <span className={styles.cardBody}>
                <span className={styles.cardTitle}>
                  <span className={styles.cardName}>{profile.displayName}</span>
                  {profile.badge === '' ? null : (
                    <span className={styles.badge}>{profile.badge}</span>
                  )}
                </span>
                <span className={styles.cardRoute}>{profile.instanceId}</span>
                <span
                  className={
                    profile.state === 'healthy'
                      ? styles.stateOk
                      : profile.state === 'cooling'
                        ? styles.stateWarn
                        : styles.stateIdle
                  }
                >
                  {STATE_LABEL[profile.state]}
                  {profile.plan === null ? '' : ` · ${profile.plan}`}
                </span>
              </span>
              <span
                className={styles.switch}
                role="switch"
                aria-checked={profile.enabled}
                aria-label={`Enable ${profile.displayName}`}
                tabIndex={0}
                onClick={event => {
                  event.stopPropagation()
                  void toggleEnabled(profile)
                }}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  event.stopPropagation()
                  void toggleEnabled(profile)
                }}
              >
                <span className={profile.enabled ? styles.knobOn : styles.knobOff} />
              </span>
            </button>
          ))}
        </div>

        <div className={styles.detail}>
          {addingKind === null && draft === null ? (
            <p className={styles.empty}>Select an account to edit it.</p>
          ) : null}

          {addingKind === null && draft !== null ? (
            <>
              <h2 className={styles.detailTitle}>{draft.displayName || draft.instanceId}</h2>
              <p className={styles.detailSub}>
                {KIND_LABEL[draft.kind]} · {draft.kind === 'codex' ? 'Shared state, private auth' : 'API key from the environment'}
              </p>

              <Field label="Route slug" hint="Letters, digits, dash and underscore. Appears as the provider in the model picker.">
                <input
                  className={styles.input}
                  value={draft.instanceId}
                  onChange={event => setDraft({ ...draft, instanceId: event.target.value })}
                />
              </Field>

              <Field label="Display name">
                <input
                  className={styles.input}
                  value={draft.displayName}
                  placeholder={KIND_LABEL[draft.kind]}
                  onChange={event => setDraft({ ...draft, displayName: event.target.value })}
                />
              </Field>

              <Field label="Badge" hint="Short tag shown beside the name, e.g. work.">
                <input
                  className={styles.input}
                  value={draft.badge}
                  onChange={event => setDraft({ ...draft, badge: event.target.value })}
                />
              </Field>

              <Field label="Accent color">
                <input
                  className={styles.input}
                  value={draft.accentColor}
                  onChange={event => setDraft({ ...draft, accentColor: event.target.value })}
                />
              </Field>

              <Field label="Icon">
                <select
                  className={styles.input}
                  value={draft.providerIcon}
                  onChange={event => setDraft({ ...draft, providerIcon: event.target.value })}
                >
                  {PROVIDER_ICONS.map(icon => (
                    <option key={icon} value={icon}>
                      {icon}
                    </option>
                  ))}
                </select>
              </Field>

              {draft.kind === 'codex' ? (
                <>
                  <Field label="CODEX_HOME path" hint="Where shared sessions, skills and plugins live.">
                    <input
                      className={styles.input}
                      value={draft.homePath}
                      onChange={event => setDraft({ ...draft, homePath: event.target.value })}
                    />
                  </Field>
                  <Field
                    label="Shadow home path"
                    hint="Account-specific home. Keeps auth.json separate while sharing state. Leave empty for one under the shadow root."
                  >
                    <input
                      className={styles.input}
                      value={draft.shadowHomePath}
                      onChange={event => setDraft({ ...draft, shadowHomePath: event.target.value })}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field
                    label="API key environment variable"
                    hint="Named, not valued: the key never enters this file."
                  >
                    <input
                      className={styles.input}
                      value={draft.apiKeyEnv}
                      placeholder={
                        draft.kind === 'commandcode'
                          ? 'COMMANDCODE_API_KEY'
                          : 'OPENCODE_API_KEY'
                      }
                      onChange={event => setDraft({ ...draft, apiKeyEnv: event.target.value })}
                    />
                  </Field>
                  {draft.kind === 'commandcode' ? (
                    <Field
                      label="API base URL"
                      hint="Leave empty for Command Code's own deployment."
                    >
                      <input
                        className={styles.input}
                        value={draft.apiBaseUrl}
                        placeholder="https://api.commandcode.ai"
                        onChange={event => setDraft({ ...draft, apiBaseUrl: event.target.value })}
                      />
                    </Field>
                  ) : null}
                </>
              )}

              <div className={styles.detailActions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!dirty || saving || draft.instanceId.trim().length === 0}
                  onClick={() => void save(draft)}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setDraft(selected === null ? null : { ...selected })}
                  disabled={!dirty}
                >
                  Revert
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => selected !== null && void remove(selected)}
                >
                  Remove
                </button>
              </div>

              <ModelCuration
                account={draft}
                catalog={catalog?.models}
                onChange={next => setDraft({ ...draft, ...next })}
              />

              <ReasoningDefaults
                account={draft}
                catalog={catalog?.models}
                onChange={reasoningDefaults => setDraft({ ...draft, reasoningDefaults })}
              />

              <div className={styles.historySection}>
                <div className={styles.historyHead}>
                  <span className={styles.fieldLabel}>Quota history</span>
                  <select
                    className={styles.historyRange}
                    value={String(historyDays)}
                    onChange={event => setHistoryDays(Number(event.target.value))}
                    aria-label="History range"
                  >
                    {[1, 3, 7, 14, 30].map(days => (
                      <option key={days} value={String(days)}>
                        {days}d
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={styles.historyRefresh}
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
                </div>
                <UsageHistoryChart points={history} days={historyDays} />
              </div>

              <UsageCardView
                usage={usage?.cards.find(card => card.instanceId === selected?.instanceId)?.usage}
              />

              {selected !== null && selected.kind === 'codex' ? (
                <div className={styles.status}>
                  <div>
                    <span className={styles.statusLabel}>Home</span>
                    <span className={styles.statusValue}>
                      {selected.homePath === '' ? '~/.codex' : selected.homePath}
                    </span>
                  </div>
                  <div>
                    <span className={styles.statusLabel}>Mode</span>
                    <span className={styles.statusValue}>
                      {selected.mode === 'authOverlay' ? 'Shared state, private auth' : 'Direct'}
                    </span>
                  </div>
                  <div>
                    <span className={styles.statusLabel}>Account</span>
                    <span className={styles.statusValue}>
                      {selected.identity ?? (selected.signedIn ? 'signed in' : 'not signed in')}
                    </span>
                  </div>
                  {selected.signedIn ? null : (
                    <div className={styles.loginHint}>
                      <span>Sign in with</span>
                      <code>{selected.loginHint}</code>
                      <button
                        type="button"
                        className={styles.copyButton}
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(selected.loginHint)
                            .then(() => setNotice('Copied the sign-in command.'))
                            .catch(() =>
                              setNotice('Could not copy; select the command and copy it.'),
                            )
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  )}
                  {selected.detail === null ? null : (
                    <p className={styles.warnText}>{selected.detail}</p>
                  )}
                </div>
              ) : null}
            </>
          ) : null}

          {addingKind !== null ? (
            <>
              <h2 className={styles.detailTitle}>New {KIND_LABEL[addingKind]} account</h2>
              <p className={styles.detailSub}>
                Give it a route slug; each account becomes its own provider in the picker.
              </p>
              <NewAccountForm
                kind={addingKind}
                onCancel={() => setAddingKind(null)}
                onCreate={async draft => {
                  setAddingKind(null)
                  setSelectedId(draft.instanceId)
                  await save(draft)
                }}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const NewAccountForm = (props: {
  readonly kind: AccountProfile['kind']
  readonly onCancel: () => void
  readonly onCreate: (draft: AccountDraft) => Promise<void>
}): JSX.Element => {
  const [draft, setDraft] = useState<AccountDraft>(() => blankAccount(props.kind))
  const invalid = draft.instanceId.trim().length === 0
  return (
    <>
      <Field label="Route slug" hint="For example codex_work.">
        <input
          className={styles.input}
          value={draft.instanceId}
          placeholder="codex_work"
          onChange={event => setDraft({ ...draft, instanceId: event.target.value })}
        />
      </Field>
      <Field label="Display name">
        <input
          className={styles.input}
          value={draft.displayName}
          placeholder={KIND_LABEL[props.kind]}
          onChange={event => setDraft({ ...draft, displayName: event.target.value })}
        />
      </Field>
      {props.kind === 'codex' ? (
        <Field label="CODEX_HOME path" hint="Where shared sessions and skills live.">
          <input
            className={styles.input}
            value={draft.homePath}
            onChange={event => setDraft({ ...draft, homePath: event.target.value })}
          />
        </Field>
      ) : (
        <Field label="API key environment variable">
          <input
            className={styles.input}
            value={draft.apiKeyEnv}
            placeholder="OPENCODE_API_KEY"
            onChange={event => setDraft({ ...draft, apiKeyEnv: event.target.value })}
          />
        </Field>
      )}
      <div className={styles.detailActions}>
        <button
          type="button"
          className={styles.primary}
          disabled={invalid}
          onClick={() => void props.onCreate(draft)}
        >
          Create
        </button>
        <button type="button" className={styles.secondary} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </>
  )
}

import { aiAccountsApi as api } from './api.js'