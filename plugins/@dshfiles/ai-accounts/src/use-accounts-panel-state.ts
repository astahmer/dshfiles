import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AccountDraftModel } from './account-draft.js'
import { AccountWriteQueue } from './account-write-queue.js'
import type { AccountRemovalTarget } from './account-remove-machine.js'
import { useAutoSaver } from './auto-save.js'
import { connectHintFor } from './account-labels.js'
import { acceptAccountOrder, aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import { AccountsRules, aiAccountsApi, type AccountDraft, type AccountOrderDirection, type AccountProfile, type AccountsFile } from './api.js'
import type { CredentialSetupPort } from './credential-setup-port.js'
import { useAccountsUsage } from './use-accounts-usage.js'
import { usePreferences } from './use-preferences.js'

export const useAccountsPanelState = (credentialSetup?: CredentialSetupPort) => {
  const accounts = useApi(aiAccountsApi)
  const queryClient = useQueryClient()
  const preferences = usePreferences()
  const { usage } = useAccountsUsage()
  const [historyDays, setHistoryDays] = useState(7)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AccountDraft | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [enqueueWrite] = useState(() => AccountWriteQueue.create())
  const reordering = useIsMutating({ mutationKey: aiAccountsKeys.orderMutation }) > 0
  // The slug the store holds for the selection when a queued write runs; an earlier rename in the queue moves it.
  const storedSelectionId = useRef<string | null>(null)
  useEffect(() => {
    storedSelectionId.current = selectedId
  }, [selectedId])

  const fileQuery = useQuery(aiAccountsQueries.file(accounts))
  const file = fileQuery.data ?? null
  const setFile = (next: AccountsFile): void => {
    // Saved edits carry order too: an older read must not restore priority from before the write.
    void acceptAccountOrder(queryClient, next)
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

  // The editor follows the selection, and keeps unsaved edits across re-reads and renames.
  const followedId = useRef<string | null>(null)
  useEffect(() => {
    const previouslyFollowed = followedId.current
    setDraft(current => AccountDraftModel.followSelection({ current, selected, selectedId, followedId: previouslyFollowed }))
    if (selected !== null) followedId.current = selected.instanceId
  }, [selected, selectedId])

  const dirty = selected !== null && draft !== null && !AccountDraftModel.sameDraft(selected, draft)
  const problem = draft === null ? null : AccountDraftModel.draftProblem(draft)
  const credentialRefName = draft?.apiKeyEnv.trim() ?? ''
  const credentialInfoQuery = useQuery({
    queryKey: aiAccountsKeys.credential(credentialRefName),
    queryFn: () => credentialSetup?.describe(credentialRefName) ?? Promise.reject(new Error('Credential setup is unavailable.')),
    enabled: credentialSetup !== undefined && AccountsRules.isKeyEnvName(credentialRefName),
    staleTime: 10_000,
    retry: false,
  })
  const { saver, status: autoSave } = useAutoSaver<AccountDraft>({
    save: async next => setFile(await enqueueWrite(() => accounts.save({ draft: next }))),
    equals: AccountDraftModel.sameDraft,
    delayMs: preferences.autoSaveDelayMs,
  })

  // Renames are committed explicitly (on blur), so a half-typed slug never
  // becomes a route; every other field saves itself after a pause.
  useEffect(() => {
    if (preferences.saveMode !== 'auto' || selected === null || draft === null) return
    if (draft.instanceId !== selected.instanceId || AccountDraftModel.sameDraft(selected, draft) || AccountDraftModel.draftProblem(draft) !== null) return
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
  // A rename reads the slug it renames when it runs, so a save queued behind another rename renames nothing twice.
  const saveMutation = useMutation({
    mutationFn: (input: { readonly draft: AccountDraft; readonly renamesSelection: boolean }) =>
      enqueueWrite(async () => {
        const storedId = storedSelectionId.current
        const previousInstanceId = input.renamesSelection && storedId !== null && storedId !== input.draft.instanceId ? storedId : undefined
        const file = await accounts.save(previousInstanceId === undefined ? { draft: input.draft } : { draft: input.draft, previousInstanceId })
        storedSelectionId.current = input.draft.instanceId
        return { file, renamed: previousInstanceId !== undefined }
      }),
    onMutate: () => setNotice(null),
    onSuccess: (next, input) => {
      setFile(next.file)
      setSelectedId(input.draft.instanceId)
    },
  })
  const moveAccountMutation = useMutation({
    mutationKey: aiAccountsKeys.orderMutation,
    scope: { id: 'ai-accounts-order' },
    mutationFn: (input: { readonly instanceId: string; readonly direction: AccountOrderDirection }) => enqueueWrite(() => accounts.moveAccount(input)),
    onMutate: () => setNotice(null),
    onSuccess: next => acceptAccountOrder(queryClient, next),
    onError: error => {
      setNotice(`Could not reorder account: ${String(error)}`)
      return queryClient.invalidateQueries({ queryKey: aiAccountsKeys.file })
    },
  })
  const removeMutation = useMutation({
    mutationFn: async (target: AccountRemovalTarget) => {
      const next = await enqueueWrite(() => accounts.remove({ instanceId: target.instanceId }))
      setFile(next)
      return next
    },
    onMutate: () => setNotice(null),
    onSuccess: (_next, target) => {
      setSelectedId(current => (current === target.instanceId ? null : current))
      setNotice(`Removed ${target.displayName}. Credentials were left on disk.`)
    },
  })

  const save = async (next: AccountDraft): Promise<boolean> => {
    try {
      const { renamed } = await saveMutation.mutateAsync({ draft: next, renamesSelection: true })
      saver.markSaved(next)
      setNotice(renamed ? `Renamed to ${next.instanceId}.` : 'Saved. New sessions use the updated route settings.')
      return true
    } catch (error) {
      setNotice(`Could not save: ${String(error)}`)
      return false
    }
  }

  const storeCredential = async (input: { readonly ref: string; readonly value: string }): Promise<boolean> => {
    if (credentialSetup === undefined || draft === null || problem !== null || input.ref !== draft.apiKeyEnv.trim() || !AccountsRules.isKeyEnvName(input.ref)) {
      setNotice('Save a valid account and API-key variable before storing a key.')
      return false
    }
    if (!(await save(draft))) return false
    if (input.value.length === 0) {
      setNotice('Enter a non-empty key.')
      return false
    }
    try {
      await credentialSetup.set(input.ref, input.value)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: aiAccountsKeys.credential(input.ref) }),
        queryClient.invalidateQueries({ queryKey: aiAccountsKeys.file }),
        queryClient.invalidateQueries({ queryKey: aiAccountsKeys.usage }),
      ])
      setNotice('Key stored in DSH credentials. The next request uses it; no relaunch needed.')
      return true
    } catch {
      setNotice('Could not store the key. A read-only environment source may shadow this variable; choose another API-key variable or update its source.')
      return false
    }
  }

  const importSecretCatalogKey = async (input: {
    readonly alias: string
    readonly environment: string
    readonly scope: 'global' | 'project' | 'local'
    readonly cwd: string | null
    readonly replaceExisting?: boolean
  }): Promise<boolean> => {
    if (draft === null || problem !== null || !AccountsRules.isKeyEnvName(draft.apiKeyEnv.trim())) {
      setNotice('Save a valid API-key variable ending in _API_KEY before importing a key.')
      return false
    }
    if (!(await save(draft))) return false
    try {
      await accounts.importSecretCatalogKey({ instanceId: draft.instanceId, ...input })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: aiAccountsKeys.credential(draft.apiKeyEnv.trim()) }),
        queryClient.invalidateQueries({ queryKey: aiAccountsKeys.file }),
        queryClient.invalidateQueries({ queryKey: aiAccountsKeys.usage }),
      ])
      setNotice(
        input.replaceExisting
          ? 'Key replaced from Secret Catalog. The next request uses it; no relaunch needed.'
          : 'Secret imported into DSH credentials. The next request uses it; no relaunch needed.',
      )
      return true
    } catch {
      setNotice('The account mapping was saved, but the Secret Catalog key could not be imported. Check the entry and retry.')
      return false
    }
  }

  /** Commit a route-slug edit: in auto mode on blur, in manual mode with Save. */
  const commitRename = async () => {
    if (preferences.saveMode !== 'auto' || selected === null || draft === null || draft.instanceId === selected.instanceId) return
    if (AccountDraftModel.draftProblem(draft) !== null) return
    await save(draft)
  }

  // An edit supersedes the last notice (e.g. "Added Codex 1…"), which would otherwise hide the manual-mode "Unsaved changes." status.
  const editDraft = (next: AccountDraft) => {
    setNotice(null)
    setDraft(next)
  }

  const revert = () => {
    saver.cancel()
    setDraft(selected === null ? null : AccountDraftModel.toDraft(selected))
  }

  /** Write straight through, for the toggles the reference page saves on click. */
  const persist = async (patch: Partial<AccountDraft>) => {
    if (selected === null) return
    const next = { ...AccountDraftModel.toDraft(selected), ...patch }
    setDraft(current => (current === null ? next : { ...current, ...patch }))
    try {
      setFile(await enqueueWrite(() => accounts.save({ draft: next })))
      saver.markSaved(next)
    } catch (error) {
      setNotice(`Could not save: ${String(error)}`)
      setDraft(AccountDraftModel.toDraft(selected))
    }
  }

  const moveAccount = (instanceId: string, direction: AccountOrderDirection): void => {
    moveAccountMutation.mutate({ instanceId, direction })
  }

  const toggleEnabled = async (profile: AccountProfile) => {
    setFile(await enqueueWrite(() => accounts.save({ draft: { ...AccountDraftModel.toDraft(profile), enabled: !profile.enabled } })))
  }

  const remove = async (target: AccountRemovalTarget): Promise<void> => {
    await removeMutation.mutateAsync(target)
  }

  /**
   * One click, one account. The user signs in afterwards; the panel polls the
   * identity and the card lights up when Codex writes the file.
   */
  const createAccount = async (kind: AccountProfile['kind']) => {
    const next = AccountDraftModel.newAccountDraft({ kind, existing: file?.accounts ?? [] })
    try {
      await saveMutation.mutateAsync({ draft: next, renamesSelection: false })
      setNotice(`Added ${next.displayName}. ${connectHintFor(kind)}`)
    } catch (error) {
      setNotice(`Could not add the account: ${String(error)}`)
    }
  }

  const copy = async (text: string, message: string) => {
    setNotice((await writeClipboard(text)) ? message : `Copy this into a terminal: ${text}`)
  }

  const copyPath = async (): Promise<void> => {
    try {
      await copy(await accounts.filePath(), 'Accounts file path copied. It contains account settings, not key values.')
    } catch {
      setNotice('Could not read the accounts file path.')
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
    setDraft: editDraft,
    dirty,
    problem,
    credentialInfo: credentialInfoQuery.data ?? null,
    credentialInfoLoading: credentialInfoQuery.isFetching,
    credentialInfoUnavailable: credentialInfoQuery.isError,
    credentialSetupAvailable: credentialSetup !== undefined,
    storeCredential,
    importSecretCatalogKey,
    saveMode: preferences.saveMode,
    autoSave,
    retryAutoSave: () => void saver.retry().catch(() => undefined),
    commitRename,
    revert,
    notice: notice ?? (fileQuery.isError && file === null ? 'The account host did not answer.' : null),
    setNotice,
    saving: saveMutation.isPending,
    reordering,
    load,
    save,
    persist,
    moveAccount,
    toggleEnabled,
    remove,
    createAccount,
    copy,
    copyPath,
    preferences,
  }
}

export type AccountsPanelState = ReturnType<typeof useAccountsPanelState>
