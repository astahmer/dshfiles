import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { draftProblem, newAccountDraft, sameDraft, toDraft } from './account-draft.js'
import { createAutoSaver, type AutoSaveStatus, type AutoSaver } from './auto-save.js'
import { connectHintFor } from './account-labels.js'
import {
  aiAccountsApi,
  type AccountDraft,
  type AccountProfile,
  type AccountsCatalog,
  type AccountsFile,
  type UsageHistoryPoint,
} from './api.js'
import { useAccountsUsage } from './use-accounts-usage.js'
import { usePreferences } from './use-preferences.js'


export const useAccountsPanelState = () => {
  const accounts = useApi(aiAccountsApi)
  const preferences = usePreferences()
  const { usage } = useAccountsUsage()
  const [autoSave, setAutoSave] = useState<AutoSaveStatus>({ kind: 'idle' })
  const [catalog, setCatalog] = useState<AccountsCatalog | null>(null)
  const [refreshingCatalog, setRefreshingCatalog] = useState(false)
  const [history, setHistory] = useState<readonly UsageHistoryPoint[]>([])
  const [historyDays, setHistoryDays] = useState(7)
  const [file, setFile] = useState<AccountsFile | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AccountDraft | null>(null)
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

  const selected = useMemo(() => file?.accounts.find(account => account.instanceId === selectedId) ?? null, [file, selectedId])

  // The editor follows the selection, and keeps unsaved edits across re-reads.
  useEffect(() => {
    if (selected === null) {
      setDraft(null)
      return
    }
    setDraft(current => (current !== null && current.instanceId === selected.instanceId && !sameDraft(selected, current) ? current : toDraft(selected)))
  }, [selected])

  const dirty = selected !== null && draft !== null && !sameDraft(selected, draft)
  const problem = draft === null ? null : draftProblem(draft)

  // The saver outlives renders; its callbacks read the latest values through refs.
  const delayRef = useRef(preferences.autoSaveDelayMs)
  delayRef.current = preferences.autoSaveDelayMs
  const saverRef = useRef<AutoSaver<AccountDraft> | null>(null)
  saverRef.current ??= createAutoSaver<AccountDraft>({
    save: async next => setFile(await accounts.save({ draft: next })),
    equals: sameDraft,
    onStatus: setAutoSave,
    delayMs: () => delayRef.current,
  })
  const saver = saverRef.current

  // Renames are committed explicitly (on blur), so a half-typed slug never
  // becomes a route; every other field saves itself after a pause.
  useEffect(() => {
    if (preferences.saveMode !== 'auto' || selected === null || draft === null) return
    if (draft.instanceId !== selected.instanceId || sameDraft(selected, draft) || draftProblem(draft) !== null) return
    saver.schedule(draft)
  }, [draft, selected, preferences.saveMode, saver])

  useEffect(() => {
    if (preferences.saveMode === 'manual') saver.cancel()
  }, [preferences.saveMode, saver])

  // Leaving an account (or the page) writes what is waiting rather than dropping it.
  useEffect(
    () => () => {
      void saver.flush().catch(() => undefined)
    },
    [selectedId, saver],
  )

  const save = async (next: AccountDraft) => {
    setSaving(true)
    setNotice(null)
    const previousInstanceId = selectedId !== null && selectedId !== next.instanceId ? selectedId : undefined
    try {
      setFile(await accounts.save({ draft: next, ...(previousInstanceId === undefined ? {} : { previousInstanceId }) }))
      setSelectedId(next.instanceId)
      saver.markSaved(next)
      setNotice(previousInstanceId === undefined ? 'Saved. New sessions use the updated route settings.' : `Renamed to ${next.instanceId}.`)
    } catch (error) {
      setNotice(`Could not save: ${String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  /** Commit a route-slug edit: in auto mode on blur, in manual mode with Save. */
  const commitRename = async () => {
    if (preferences.saveMode !== 'auto' || selected === null || draft === null || draft.instanceId === selected.instanceId) return
    if (draftProblem(draft) !== null) return
    await save(draft)
  }

  const revert = () => {
    saver.cancel()
    setDraft(selected === null ? null : toDraft(selected))
  }

  /** Write straight through, for the toggles the reference page saves on click. */
  const persist = async (patch: Partial<AccountDraft>) => {
    if (selected === null) return
    const next = { ...toDraft(selected), ...patch }
    setDraft(current => (current === null ? next : { ...current, ...patch }))
    try {
      setFile(await accounts.save({ draft: next }))
      saver.markSaved(next)
    } catch (error) {
      setNotice(`Could not save: ${String(error)}`)
      setDraft(toDraft(selected))
    }
  }

  const toggleEnabled = async (profile: AccountProfile) => {
    setFile(await accounts.save({ draft: { ...toDraft(profile), enabled: !profile.enabled } }))
  }

  const remove = async (profile: AccountProfile) => {
    setFile(await accounts.remove({ instanceId: profile.instanceId }))
    setSelectedId(current => (current === profile.instanceId ? null : current))
    setNotice(`Removed ${profile.displayName}. Credentials were left on disk.`)
  }

  /**
   * One click, one account. The user signs in afterwards; the panel polls the
   * identity and the card lights up when Codex writes the file.
   */
  const createAccount = async (kind: AccountProfile['kind']) => {
    setSaving(true)
    setNotice(null)
    try {
      const next = newAccountDraft({ kind, existing: file?.accounts ?? [] })
      setFile(await accounts.save({ draft: next }))
      setSelectedId(next.instanceId)
      setNotice(`Added ${next.displayName}. ${connectHintFor(kind)}`)
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

  return {
    accounts,
    usage,
    catalog,
    refreshingCatalog,
    refreshCatalog,
    history,
    setHistory,
    historyDays,
    setHistoryDays,
    file,
    setFile,
    selectedId,
    setSelectedId,
    selected,
    draft,
    setDraft,
    dirty,
    problem,
    saveMode: preferences.saveMode,
    autoSave,
    retryAutoSave: () => void saver.retry().catch(() => undefined),
    commitRename,
    revert,
    notice,
    setNotice,
    saving,
    load,
    save,
    persist,
    toggleEnabled,
    remove,
    createAccount,
    copy,
    preferences,
  }
}

export type AccountsPanelState = ReturnType<typeof useAccountsPanelState>
