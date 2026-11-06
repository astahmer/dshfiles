import { assign, raise, setup, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import { AccountDraftModel } from './account-draft.js'
import type { AccountDraft, AccountProfile } from './api.js'
import type { AutoSaveStatus, AutoSaver } from './auto-save.js'

export type AccountSaveMode = 'auto' | 'manual'

export interface AccountEditorInput {
  readonly saver: AutoSaver<AccountDraft>
  readonly saveMode: AccountSaveMode
}

interface AccountEditorContext extends AccountEditorInput {
  readonly selectedId: string | null
  readonly draft: AccountDraft | null
  readonly baseline: AccountProfile | null
  readonly followedId: string | null
  readonly storedId: string | null
  readonly initialSelected: boolean
  readonly autoSave: AutoSaveStatus
}

type AccountEditorEvent =
  | { readonly type: 'store.loaded'; readonly firstInstanceId: string | null }
  | { readonly type: 'selection.select'; readonly instanceId: string | null }
  | { readonly type: 'selection.selectIfCurrent'; readonly instanceId: string; readonly next: string | null }
  | { readonly type: 'selection.selectIfNone'; readonly instanceId: string | null }
  | { readonly type: 'selection.stored'; readonly instanceId: string }
  | { readonly type: 'selection.follow'; readonly selected: AccountProfile | null }
  | { readonly type: 'draft.edit'; readonly draft: AccountDraft }
  | { readonly type: 'draft.revert' }
  | { readonly type: 'draft.saved'; readonly draft: AccountDraft }
  | { readonly type: 'saveMode.change'; readonly mode: AccountSaveMode }
  | { readonly type: 'autoSave.status'; readonly status: AutoSaveStatus }
  | { readonly type: 'autoSave.retry' }
  | { readonly type: 'editor.classify' }

/** The one place that decides whether the edited draft may be written by itself right now. */
const reconcileAutoSave = (context: AccountEditorContext): void => {
  if (context.saveMode !== 'auto' || context.baseline === null || context.draft === null) return
  if (AccountDraftModel.sameDraft(context.baseline, context.draft)) {
    context.saver.cancel()
    context.saver.markSaved(context.draft)
    return
  }
  if (context.draft.instanceId !== context.baseline.instanceId || AccountDraftModel.draftProblem(context.draft) !== null) return
  context.saver.schedule(context.draft)
}

const slugChanged = (context: AccountEditorContext): boolean => {
  if (context.draft === null) return false
  if (context.baseline !== null) return context.draft.instanceId !== context.baseline.instanceId
  return context.draft.instanceId !== context.followedId
}

/**
 * The editor's selection and draft, in one place: `loading` until the first store read picks an account, `empty`
 * without a selected account, and `editing` clean, dirty, or renaming (a route-slug change that commits on blur).
 * The draft follows the store through one transition instead of a render-time reconciliation flag, and every state
 * that can leave unsaved work drives the same `reconcileAutoSave` rule.
 */
// SAFETY: XState uses empty carriers for inference; runtime input and events are typed above.
export const accountEditorMachine = setup({
  types: {
    context: {} as AccountEditorContext,
    events: {} as AccountEditorEvent,
    input: {} as AccountEditorInput,
  },
  guards: {
    noDraft: ({ context }) => context.draft === null,
    slugChanged: ({ context }) => slugChanged(context),
    matchesBaseline: ({ context }) => context.baseline !== null && context.draft !== null && AccountDraftModel.sameDraft(context.baseline, context.draft),
    modeChanged: ({ context, event }) => event.type === 'saveMode.change' && event.mode !== context.saveMode,
    modeBecomesManual: ({ context, event }) => event.type === 'saveMode.change' && event.mode === 'manual' && event.mode !== context.saveMode,
  },
  actions: {
    initialSelect: assign(({ context, event }) => {
      if (event.type !== 'store.loaded' || context.initialSelected) return {}
      const instanceId = context.selectedId ?? event.firstInstanceId
      return { initialSelected: true, selectedId: instanceId, storedId: instanceId }
    }),
    select: assign(({ event }) => (event.type === 'selection.select' ? { selectedId: event.instanceId, storedId: event.instanceId } : {})),
    selectIfCurrent: assign(({ context, event }) => {
      if (event.type !== 'selection.selectIfCurrent' || context.selectedId !== event.instanceId) return {}
      return { selectedId: event.next, storedId: event.next }
    }),
    selectIfNone: assign(({ context, event }) => {
      if (event.type !== 'selection.selectIfNone' || context.selectedId !== null) return {}
      return { selectedId: event.instanceId, storedId: event.instanceId }
    }),
    storeSelection: assign(({ event }) => (event.type === 'selection.stored' ? { storedId: event.instanceId } : {})),
    follow: assign(({ context, event }) => {
      if (event.type !== 'selection.follow') return {}
      const draft = AccountDraftModel.followSelection({
        current: context.draft,
        selected: event.selected,
        selectedId: context.selectedId,
        followedId: context.followedId,
        previousSelected: context.baseline,
      })
      return { draft, baseline: event.selected, ...(event.selected !== null && { followedId: event.selected.instanceId }) }
    }),
    editDraft: assign(({ event }) => (event.type === 'draft.edit' ? { draft: event.draft } : {})),
    revertDraft: assign(({ context }) => ({ draft: context.baseline === null ? null : AccountDraftModel.toDraft(context.baseline) })),
    applySaveMode: assign(({ event }) => (event.type === 'saveMode.change' ? { saveMode: event.mode } : {})),
    rememberStatus: assign(({ event }) => (event.type === 'autoSave.status' ? { autoSave: event.status } : {})),
    flushSaver: ({ context }) => {
      void context.saver.flush().catch(() => undefined)
    },
    cancelSaver: ({ context }) => context.saver.cancel(),
    reconcile: ({ context }) => reconcileAutoSave(context),
    markSaved: ({ context, event }) => {
      if (event.type === 'draft.saved') context.saver.markSaved(event.draft)
    },
    retrySaver: ({ context }) => {
      void context.saver.retry().catch(() => undefined)
    },
    classify: raise({ type: 'editor.classify' }),
  },
}).createMachine({
  id: 'accountEditor',
  initial: 'loading',
  context: ({ input }) => ({
    saver: input.saver,
    saveMode: input.saveMode,
    selectedId: null,
    draft: null,
    baseline: null,
    followedId: null,
    storedId: null,
    initialSelected: false,
    autoSave: { kind: 'idle' },
  }),
  on: {
    'store.loaded': { actions: ['initialSelect', 'classify'] },
    'editor.classify': [
      { guard: 'noDraft', target: '.empty' },
      { guard: 'slugChanged', target: '.editing.renaming' },
      { guard: 'matchesBaseline', target: '.editing.clean' },
      { target: '.editing.dirty' },
    ],
    'selection.select': { actions: ['flushSaver', 'select'] },
    'selection.selectIfCurrent': { actions: ['flushSaver', 'selectIfCurrent'] },
    'selection.selectIfNone': { actions: ['selectIfNone'] },
    'selection.stored': { actions: ['storeSelection'] },
    // A store write cancels what was queued for the previous baseline before the new one is reconciled.
    'selection.follow': { actions: ['cancelSaver', 'follow', 'reconcile', 'classify'] },
    'draft.edit': { actions: ['editDraft', 'reconcile', 'classify'] },
    'draft.revert': { actions: ['cancelSaver', 'revertDraft', 'reconcile', 'classify'] },
    'draft.saved': { actions: ['markSaved'] },
    'saveMode.change': [
      { guard: 'modeBecomesManual', actions: ['applySaveMode', 'cancelSaver'] },
      { guard: 'modeChanged', actions: ['applySaveMode', 'reconcile'] },
    ],
    'autoSave.status': { actions: ['rememberStatus'] },
    'autoSave.retry': { actions: ['retrySaver'] },
  },
  states: {
    loading: {},
    empty: {},
    editing: {
      initial: 'clean',
      states: { clean: {}, dirty: {}, renaming: {} },
    },
  },
})

export type AccountEditorActor = ActorRefFrom<typeof accountEditorMachine>
