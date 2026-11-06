import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AccountDraftModel } from './account-draft.js'
import { AccountWriteQueue } from './account-write-queue.js'
import type { AccountRemovalTarget } from './account-remove-machine.js'
import { accountEditorMachine, type AccountEditorActor } from './account-editor-machine.js'
import { createAutoSaver, type AutoSaver } from './auto-save.js'
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
  const [notice, setNotice] = useState<string | null>(null)
  const [enqueueWrite] = useState(() => AccountWriteQueue.create())
  const reordering = useIsMutating({ mutationKey: aiAccountsKeys.orderMutation }) > 0

  const fileQuery = useQuery(aiAccountsQueries.file(accounts))
  const file = fileQuery.data ?? null
  const setFile = (next: AccountsFile): void => {
    // Cancel older reads before publishing any saved snapshot, and refresh quota eligibility/labels immediately.
    void acceptAccountOrder(queryClient, next)
    void queryClient.invalidateQueries({ queryKey: aiAccountsKeys.usage })
  }

  // The editor machine owns selection and draft; its auto-saver outlives a render, so the write reads the latest port.
  const writePort = useRef({ save: async (_draft: AccountDraft): Promise<void> => undefined, delayMs: preferences.autoSaveDelayMs })
  writePort.current = { save: async draft => setFile(await enqueueWrite(() => accounts.save({ draft }))), delayMs: preferences.autoSaveDelayMs }
  const editorRef = useRef<AccountEditorActor | null>(null)
  const saver = useRef<AutoSaver<AccountDraft> | null>(null)
  saver.current ??= createAutoSaver<AccountDraft>({
    save: draft => writePort.current.save(draft),
    equals: AccountDraftModel.sameDraft,
    onStatus: status => editorRef.current?.send({ type: 'autoSave.status', status }),
    delayMs: () => writePort.current.delayMs,
  })
  const [snapshot, send, editor] = useMachine(accountEditorMachine, { input: { saver: saver.current, saveMode: preferences.saveMode } })
  const selectedId = snapshot.context.selectedId
  const draft = snapshot.context.draft
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // Leaving the page writes what is waiting rather than dropping it.
  useEffect(
    () => () => {
      void saver.current?.flush().catch(() => undefined)
    },
    [],
  )

  const load = async (): Promise<void> => {
    const result = await fileQuery.refetch({ throwOnError: true })
    send({ type: 'selection.selectIfNone', instanceId: result.data?.accounts[0]?.instanceId ?? null })
  }

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

  // The editor follows the selection and the store: the first read picks an account, a later read never re-picks one.
  useEffect(() => {
    if (file === null) return
    send({ type: 'store.loaded', firstInstanceId: file.accounts[0]?.instanceId ?? null })
  }, [file, send])

  // Keyed on the profile object, so a re-read or another surface's write reaches the draft even when the id stays.
  useEffect(() => {
    send({ type: 'selection.follow', selected })
  }, [selected, selectedId, send])

  useEffect(() => {
    send({ type: 'saveMode.change', mode: preferences.saveMode })
  }, [preferences.saveMode, send])

  const dirty = snapshot.matches({ editing: 'dirty' }) || snapshot.matches({ editing: 'renaming' })
  const problem = draft === null ? null : AccountDraftModel.draftProblem(draft)
  const credentialRefName = draft?.apiKeyEnv.trim() ?? ''
  const credentialInfoQuery = useQuery({
    queryKey: aiAccountsKeys.credential(credentialRefName),
    queryFn: () => credentialSetup?.describe(credentialRefName) ?? Promise.reject(new Error('Credential setup is unavailable.')),
    enabled: credentialSetup !== undefined && AccountsRules.isKeyEnvName(credentialRefName),
    staleTime: 10_000,
    retry: false,
  })

  // Explicit saves and new accounts show as busy; auto-save and switch toggles write quietly.
  // A rename reads the slug it renames when it runs, so a save queued behind another rename renames nothing twice.
  const saveMutation = useMutation({
    mutationFn: (input: { readonly draft: AccountDraft; readonly renamesSelection: boolean }) =>
      enqueueWrite(async () => {
        const storedId = editor.getSnapshot().context.storedId
        const previousInstanceId = input.renamesSelection && storedId !== null && storedId !== input.draft.instanceId ? storedId : undefined
        const file = await accounts.save(previousInstanceId === undefined ? { draft: input.draft } : { draft: input.draft, previousInstanceId })
        send({ type: 'selection.stored', instanceId: input.draft.instanceId })
        return { file, renamed: previousInstanceId !== undefined }
      }),
    onMutate: () => setNotice(null),
    onSuccess: (next, input) => {
      setFile(next.file)
      send({ type: 'selection.select', instanceId: input.draft.instanceId })
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
      send({ type: 'selection.selectIfCurrent', instanceId: target.instanceId, next: null })
      setNotice(`Removed ${target.displayName}. Credentials were left on disk.`)
    },
  })

  const save = async (next: AccountDraft): Promise<boolean> => {
    try {
      const { renamed } = await saveMutation.mutateAsync({ draft: next, renamesSelection: true })
      send({ type: 'draft.saved', draft: next })
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
    const current = editor.getSnapshot().context
    if (current.saveMode !== 'auto' || current.baseline === null || current.draft === null) return
    if (current.draft.instanceId === current.baseline.instanceId) return
    if (AccountDraftModel.draftProblem(current.draft) !== null) return
    await save(current.draft)
  }

  // An edit supersedes the last notice (e.g. "Added Codex 1…"), which would otherwise hide the manual-mode "Unsaved changes." status.
  const editDraft = (next: AccountDraft) => {
    setNotice(null)
    send({ type: 'draft.edit', draft: next })
  }

  const revert = () => send({ type: 'draft.revert' })

  /** Write straight through, for the toggles the reference page saves on click. */
  const persist = async (patch: Partial<AccountDraft>) => {
    const current = editor.getSnapshot().context
    if (current.baseline === null) return
    const next = { ...AccountDraftModel.toDraft(current.baseline), ...patch }
    send({ type: 'draft.edit', draft: current.draft === null ? next : { ...current.draft, ...patch } })
    try {
      setFile(await enqueueWrite(() => accounts.save({ draft: next })))
      send({ type: 'draft.saved', draft: next })
    } catch (error) {
      setNotice(`Could not save: ${String(error)}`)
      send({ type: 'draft.revert' })
    }
  }

  const moveAccount = (instanceId: string, direction: AccountOrderDirection): void => {
    moveAccountMutation.mutate({ instanceId, direction })
  }

  const toggleEnabled = async (profile: AccountProfile): Promise<void> => {
    // A selected card shares the editor draft/autosaver. Updating only the file would make the old draft save the toggle back.
    if (profile.instanceId === selectedId) {
      await persist({ enabled: !profile.enabled })
      return
    }
    try {
      setFile(await enqueueWrite(() => accounts.save({ draft: { ...AccountDraftModel.toDraft(profile), enabled: !profile.enabled } })))
    } catch {
      setNotice('Could not update account availability. The saved state has been kept.')
    }
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
    setSelectedId: (instanceId: string | null) => send({ type: 'selection.select', instanceId }),
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
    autoSave: snapshot.context.autoSave,
    retryAutoSave: () => send({ type: 'autoSave.retry' }),
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
