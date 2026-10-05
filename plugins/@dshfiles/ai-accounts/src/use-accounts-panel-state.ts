import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { newAccountDraft, sameDraft } from './account-draft.js'
import { connectHintFor } from './account-labels.js'
import {
  aiAccountsApi,
  type AccountDraft,
  type AccountProfile,
  type AccountsCatalog,
  type AccountsFile,
  type AccountsUsage,
  type OverlaySettings,
} from './api.js'

const DEFAULT_OVERLAYS: OverlaySettings = { edgeWidget: true, footerQuota: true }

export const useAccountsPanelState = () => {
  const accounts = useApi(aiAccountsApi)
  const [usage, setUsage] = useState<AccountsUsage | null>(null)
  const [catalog, setCatalog] = useState<AccountsCatalog | null>(null)
  const [refreshingCatalog, setRefreshingCatalog] = useState(false)
  const [history, setHistory] = useState<readonly { at: number; windows: Record<string, number> }[]>([])
  const [historyDays, setHistoryDays] = useState(7)
  const [file, setFile] = useState<AccountsFile | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AccountDraft | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [overlays, setOverlays] = useState<OverlaySettings>(DEFAULT_OVERLAYS)

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
      .catch(() => setOverlays(DEFAULT_OVERLAYS))
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
    overlays,
    persistOverlay,
  }
}

export type AccountsPanelState = ReturnType<typeof useAccountsPanelState>
