import { useApi } from '@dshfiles/dshx/client'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { draftProblem, newAccountDraft, sameDraft, toDraft } from './account-draft.js'
import { createAutoSaver, type AutoSaveStatus, type AutoSaver } from './auto-save.js'
import { connectHintFor } from './account-labels.js'
import { aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi, type AccountDraft, type AccountProfile, type AccountsFile } from './api.js'
import { useAccountsUsage } from './use-accounts-usage.js'
import { usePreferences } from './use-preferences.js'

export const useAccountsPanelState = () => {
  const accounts = useApi(aiAccountsApi)
  const queryClient = useQueryClient()
  const preferences = usePreferences()
  const { usage } = useAccountsUsage()
  const [autoSave, setAutoSave] = useState<AutoSaveStatus>({ kind: 'idle' })
  const [historyDays, setHistoryDays] = useState(7)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AccountDraft | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const fileQuery = useQuery(aiAccountsQueries.file(accounts))
  const file = fileQuery.data ?? null
  const setFile = (next: AccountsFile): void => {
    queryClient.setQueryData(aiAccountsKeys.file, next)
  }
  const load = async (): Promise<void> => {
    const result = await fileQuery.refetch({ throwOnError: true })
    setSelectedId(current => current ?? result.data?.accounts[0]?.instanceId ?? null)
  }

  // The first read opens the first account; later reads keep the selection, even an empty one after a remove.
  const initialSelectionDone = useRef(false)
  useEffect(() => {
    if (file === null || initialSelectionDone.current) return
    initialSelectionDone.current = true
    setSelectedId(current => current ?? file.accounts[0]?.instanceId ?? null)
  }, [file])

  // Keyed per account, so a slow answer for the previous account never lands on this one.
  const catalogQuery = useQuery({ ...aiAccountsQueries.catalog(accounts, selectedId ?? ''), enabled: selectedId !== null })
  const catalog = selectedId === null || catalogQuery.isError ? null : (catalogQuery.data ?? null)
  const refreshCatalog = async (instanceId: string): Promise<void> => {
    await queryClient.refetchQueries({ queryKey: aiAccountsKeys.catalog(instanceId) })
  }

  const historyQuery = useQuery({
    ...aiAccountsQueries.history(accounts, { instanceId: selectedId ?? '', days: historyDays, refetchInterval: preferences.usageRefreshMs }),
    enabled: selectedId !== null,
  })
  const history = selectedId === null || historyQuery.isError ? [] : (historyQuery.data?.points ?? [])

  // A manual collect fills the chart in immediately rather than waiting for the next scheduled sweep.
  const recordUsageMutation = useMutation({
    mutationFn: () => accounts.collectUsage(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiAccountsKeys.history }),
    onError: () => setNotice('Could not record usage right now.'),
  })

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

  // Explicit saves and new accounts show as busy; auto-save and switch toggles write quietly.
  const saveMutation = useMutation({
    mutationFn: (input: { readonly draft: AccountDraft; readonly previousInstanceId?: string }) => accounts.save(input),
    onMutate: () => setNotice(null),
    onSuccess: (next, input) => {
      setFile(next)
      setSelectedId(input.draft.instanceId)
    },
  })

  const save = async (next: AccountDraft) => {
    const previousInstanceId = selectedId !== null && selectedId !== next.instanceId ? selectedId : undefined
    try {
      await saveMutation.mutateAsync({ draft: next, ...(previousInstanceId === undefined ? {} : { previousInstanceId }) })
      saver.markSaved(next)
      setNotice(previousInstanceId === undefined ? 'Saved. New sessions use the updated route settings.' : `Renamed to ${next.instanceId}.`)
    } catch (error) {
      setNotice(`Could not save: ${String(error)}`)
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
    const next = newAccountDraft({ kind, existing: file?.accounts ?? [] })
    try {
      await saveMutation.mutateAsync({ draft: next })
      setNotice(`Added ${next.displayName}. ${connectHintFor(kind)}`)
    } catch (error) {
      setNotice(`Could not add the account: ${String(error)}`)
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
  const awaitingSignIn = selected !== null && !selected.signedIn && selected.kind === 'codex'
  const signInQuery = useQuery({ ...aiAccountsQueries.signInIdentity(accounts, selected?.instanceId ?? ''), enabled: awaitingSignIn })
  const signedInNow = awaitingSignIn && signInQuery.data?.signedIn === true
  useEffect(() => {
    if (signedInNow) void queryClient.invalidateQueries({ queryKey: aiAccountsKeys.file })
  }, [signedInNow, queryClient])

  return {
    accounts,
    usage,
    catalog,
    refreshingCatalog: catalogQuery.isFetching,
    refreshCatalog,
    history,
    recordUsage: () => recordUsageMutation.mutate(),
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
    notice: notice ?? (fileQuery.isError && file === null ? 'The account host did not answer.' : null),
    setNotice,
    saving: saveMutation.isPending,
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
