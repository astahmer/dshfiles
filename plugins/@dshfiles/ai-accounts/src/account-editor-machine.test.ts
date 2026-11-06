import { createActor } from '@dshfiles/plugin-ui/machine'
import * as Schema from 'effect/Schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDraftModel } from './account-draft.js'
import { accountEditorMachine } from './account-editor-machine.js'
import { createAutoSaver } from './auto-save.js'
import { accountProfileSchema, type AccountDraft, type AccountProfile } from './api.js'

const profileOf = (draft: AccountDraft, changed: Partial<AccountDraft> = {}): AccountProfile =>
  Schema.decodeUnknownSync(accountProfileSchema)({
    ...draft,
    ...changed,
    mode: 'authOverlay',
    signedIn: true,
    identity: null,
    plan: null,
    state: 'healthy',
    loginHint: '',
    detail: null,
  })

const firstDraft = (): AccountDraft => AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] })

const start = (input: { readonly saveMode?: 'auto' | 'manual'; readonly save?: (draft: AccountDraft) => Promise<void> } = {}) => {
  const saved: AccountDraft[] = []
  const saver = createAutoSaver<AccountDraft>({
    save: async draft => {
      saved.push(draft)
      await input.save?.(draft)
    },
    equals: AccountDraftModel.sameDraft,
    onStatus: () => undefined,
    delayMs: () => 100,
  })
  const actor = createActor(accountEditorMachine, { input: { saver, saveMode: input.saveMode ?? 'auto' } }).start()
  return { actor, saved }
}

describe('account editor machine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('selects the first account once and keeps a later empty selection empty', () => {
    const { actor } = start()
    expect(actor.getSnapshot().matches('loading')).toBe(true)
    actor.send({ type: 'store.loaded', firstInstanceId: 'codex_work' })
    expect(actor.getSnapshot().context.selectedId).toBe('codex_work')
    expect(actor.getSnapshot().matches('empty')).toBe(true)

    actor.send({ type: 'selection.select', instanceId: null })
    actor.send({ type: 'store.loaded', firstInstanceId: 'codex_work' })
    expect(actor.getSnapshot().context.selectedId).toBeNull()
  })

  it('adopts the store baseline with a clean draft and keeps unrelated local edits', () => {
    const { actor } = start()
    const draft = firstDraft()
    const first = profileOf(draft, { displayName: 'Synthetic Work' })
    actor.send({ type: 'store.loaded', firstInstanceId: first.instanceId })
    actor.send({ type: 'selection.follow', selected: first })
    expect(actor.getSnapshot().matches({ editing: 'clean' })).toBe(true)
    expect(actor.getSnapshot().context.draft).toMatchObject({ displayName: 'Synthetic Work' })

    actor.send({ type: 'draft.edit', draft: { ...draft, displayName: 'Locally edited name' } })
    expect(actor.getSnapshot().matches({ editing: 'dirty' })).toBe(true)

    const disabled = profileOf(draft, { displayName: 'Synthetic Work', enabled: false })
    actor.send({ type: 'selection.follow', selected: disabled })
    expect(actor.getSnapshot().context.draft).toMatchObject({ displayName: 'Locally edited name', enabled: false })
    expect(actor.getSnapshot().context.baseline?.enabled).toBe(false)
  })

  it('reports renaming when the edited route slug differs from the store', () => {
    const { actor } = start()
    const draft = firstDraft()
    const first = profileOf(draft)
    actor.send({ type: 'store.loaded', firstInstanceId: first.instanceId })
    actor.send({ type: 'selection.follow', selected: first })
    actor.send({ type: 'draft.edit', draft: { ...draft, instanceId: 'half_typed' } })
    expect(actor.getSnapshot().matches({ editing: 'renaming' })).toBe(true)
    actor.send({ type: 'draft.edit', draft: { ...draft, displayName: 'Only the name' } })
    expect(actor.getSnapshot().matches({ editing: 'dirty' })).toBe(true)
  })

  it('saves a dirty draft by itself once the debounce passes, and stops once the store adopted it', async () => {
    const { actor, saved } = start()
    const draft = firstDraft()
    const first = profileOf(draft)
    actor.send({ type: 'store.loaded', firstInstanceId: first.instanceId })
    actor.send({ type: 'selection.follow', selected: first })

    const edited = { ...draft, displayName: 'Locally edited name' }
    actor.send({ type: 'draft.edit', draft: edited })
    expect(saved).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(150)
    expect(saved).toEqual([edited])

    actor.send({ type: 'selection.follow', selected: profileOf(edited) })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(saved).toEqual([edited])
    expect(actor.getSnapshot().matches({ editing: 'clean' })).toBe(true)
  })

  it('does not save by itself in manual mode, and picks a dirty draft up when auto mode returns', async () => {
    const { actor, saved } = start({ saveMode: 'manual' })
    const draft = firstDraft()
    const first = profileOf(draft)
    actor.send({ type: 'store.loaded', firstInstanceId: first.instanceId })
    actor.send({ type: 'selection.follow', selected: first })

    const edited = { ...draft, displayName: 'Locally edited name' }
    actor.send({ type: 'draft.edit', draft: edited })
    await vi.advanceTimersByTimeAsync(500)
    expect(saved).toHaveLength(0)

    actor.send({ type: 'saveMode.change', mode: 'auto' })
    await vi.advanceTimersByTimeAsync(150)
    expect(saved).toEqual([edited])
  })

  it('cancels a queued save when manual mode resumes', async () => {
    const { actor, saved } = start()
    const draft = firstDraft()
    const first = profileOf(draft)
    actor.send({ type: 'store.loaded', firstInstanceId: first.instanceId })
    actor.send({ type: 'selection.follow', selected: first })
    actor.send({ type: 'draft.edit', draft: { ...draft, displayName: 'Locally edited name' } })

    actor.send({ type: 'saveMode.change', mode: 'manual' })
    await vi.advanceTimersByTimeAsync(500)
    expect(saved).toHaveLength(0)
  })

  it('reverts to the followed store baseline', () => {
    const { actor } = start()
    const draft = firstDraft()
    const first = profileOf(draft, { displayName: 'Synthetic Work' })
    actor.send({ type: 'store.loaded', firstInstanceId: first.instanceId })
    actor.send({ type: 'selection.follow', selected: first })
    actor.send({ type: 'draft.edit', draft: { ...draft, displayName: 'Locally edited name' } })
    actor.send({ type: 'draft.revert' })
    expect(actor.getSnapshot().context.draft).toMatchObject({ displayName: 'Synthetic Work' })
    expect(actor.getSnapshot().matches({ editing: 'clean' })).toBe(true)
  })
})
