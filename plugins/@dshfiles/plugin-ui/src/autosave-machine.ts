import { useMachine } from '@xstate/react'
import { useMemo, useRef } from 'react'
import { assign, fromPromise, setup } from 'xstate'

export interface AutosaveOptions<Value> {
  /** Debounce before saving an edit; omit for explicit saves only (`flush`). */
  readonly delayMs?: number
  readonly equals?: (left: Value, right: Value) => boolean
}

interface AutosaveInput<Value> {
  readonly value: Value
  readonly save: (value: Value) => Promise<void>
}

interface AutosaveContext<Value> {
  readonly save: (value: Value) => Promise<void>
  readonly equals: (left: Value, right: Value) => boolean
  draft: Value
  persisted: Value
  inFlight: { readonly value: Value } | null
  flushRequested: boolean
  error: unknown
}

type AutosaveEvent<Value> =
  | { readonly type: 'begin'; readonly value: Value }
  | { readonly type: 'edit'; readonly value: Value }
  | { readonly type: 'flush' }
  | { readonly type: 'cancel' }
  | { readonly type: 'sync'; readonly value: Value }
  | { readonly type: 'error'; readonly error: unknown }

export type AutosaveState = 'synced' | 'dirty' | 'saving' | 'saved' | 'failed'

/**
 * One debounced, serialized save flow: an edit debounces into a save, `flush` saves now (leave or submit), a running
 * save is never overlapped or superseded, and a value edited while saving returns to `dirty` instead of reporting
 * `saved`. `sync` applies an external value only while nothing local is pending. With no `delayMs` the flow saves on
 * `flush` alone.
 */
export const createAutosaveMachine = <Value>(options: AutosaveOptions<Value> = {}) => {
  const equals = options.equals ?? Object.is
  return setup({
    // SAFETY: XState reads these empty carriers only for inference; nothing dereferences their values.
    types: {
      context: {} as AutosaveContext<Value>,
      events: {} as AutosaveEvent<Value>,
      input: {} as AutosaveInput<Value>,
    },
    actors: {
      save: fromPromise<void, { readonly save: (value: Value) => Promise<void>; readonly value: Value }>(async ({ input }) => {
        await input.save(input.value)
      }),
    },
    delays: { debounce: () => options.delayMs ?? 0 },
    guards: {
      editedWhileSaving: ({ context }) => context.inFlight !== null && !context.equals(context.draft, context.inFlight.value),
      flushWithNewerDraft: ({ context }) => context.flushRequested && context.inFlight !== null && !context.equals(context.draft, context.inFlight.value),
    },
    actions: {
      setDraft: assign(({ event }) => ('value' in event ? { draft: event.value } : {})),
      resetDraft: assign({ draft: ({ context }) => context.persisted, error: null }),
      synchronize: assign(({ event }) => ('value' in event ? { draft: event.value, persisted: event.value, error: null } : {})),
      reportError: assign(({ event }) => ('error' in event ? { error: event.error } : {})),
      startSave: assign(({ context }) => ({ inFlight: { value: context.draft }, flushRequested: false, error: null })),
      requestFlush: assign({ flushRequested: true }),
      commitSave: assign(({ context }) => ({ persisted: context.inFlight?.value ?? context.persisted, inFlight: null, flushRequested: false, error: null })),
    },
  }).createMachine({
    id: 'autosave',
    initial: 'synced',
    context: ({ input }) => ({
      save: input.save,
      equals,
      draft: input.value,
      persisted: input.value,
      inFlight: null,
      flushRequested: false,
      error: null,
    }),
    states: {
      synced: {
        on: {
          begin: { target: 'dirty', actions: 'setDraft' },
          edit: { target: 'dirty', actions: 'setDraft' },
          flush: { target: 'saving', actions: 'startSave' },
          cancel: { actions: 'resetDraft' },
          sync: { actions: 'synchronize' },
          error: { actions: 'reportError' },
        },
      },
      dirty: {
        // oxlint-disable-next-line antislop/no-conditional-empty-object-spread -- the debounce transition exists only for autosave callers; omitting it is what keeps explicit-save callers from writing on every edit.
        ...(options.delayMs === undefined ? {} : { after: { debounce: { target: 'saving' as const, actions: 'startSave' } } }),
        on: {
          begin: { target: 'dirty', reenter: true, actions: 'setDraft' },
          edit: { target: 'dirty', reenter: true, actions: 'setDraft' },
          flush: { target: 'saving', actions: 'startSave' },
          cancel: { target: 'synced', actions: 'resetDraft' },
          error: { actions: 'reportError' },
        },
      },
      saving: {
        invoke: {
          src: 'save',
          input: ({ context }) => {
            if (context.inFlight === null) throw new Error('Nothing to save.')
            return { save: context.save, value: context.inFlight.value }
          },
          onDone: [
            { guard: 'flushWithNewerDraft', target: 'saving', reenter: true, actions: ['commitSave', 'startSave'] },
            { guard: 'editedWhileSaving', target: 'dirty', actions: 'commitSave' },
            { target: 'saved', actions: 'commitSave' },
          ],
          onError: { target: 'failed', actions: assign(({ event }) => ({ inFlight: null, flushRequested: false, error: event.error })) },
        },
        on: {
          begin: { actions: 'setDraft' },
          edit: { actions: 'setDraft' },
          flush: { actions: 'requestFlush' },
          error: { actions: 'reportError' },
        },
      },
      saved: {
        on: {
          begin: { target: 'dirty', actions: 'setDraft' },
          edit: { target: 'dirty', actions: 'setDraft' },
          flush: { target: 'saving', actions: 'startSave' },
          cancel: { actions: 'resetDraft' },
          sync: { actions: 'synchronize' },
          error: { actions: 'reportError' },
        },
      },
      failed: {
        on: {
          begin: { target: 'dirty', actions: 'setDraft' },
          edit: { target: 'dirty', actions: 'setDraft' },
          flush: { target: 'saving', actions: 'startSave' },
          cancel: { target: 'synced', actions: 'resetDraft' },
          error: { actions: 'reportError' },
        },
      },
    },
  })
}

/** Run one autosave machine against the latest render's `save`, so a call site never keeps a stale closure. */
export const useAutosave = <Value>(props: {
  readonly initial: Value
  readonly save: (value: Value) => Promise<void>
  readonly delayMs?: number
  readonly equals?: (left: Value, right: Value) => boolean
}) => {
  const latest = useRef(props)
  latest.current = props
  const machine = useMemo(
    () =>
      createAutosaveMachine<Value>(
        props.delayMs === undefined
          ? { equals: (left, right) => latest.current.equals?.(left, right) ?? Object.is(left, right) }
          : { delayMs: props.delayMs, equals: (left, right) => latest.current.equals?.(left, right) ?? Object.is(left, right) },
      ),
    [props.delayMs],
  )
  const [snapshot, send] = useMachine(machine, {
    input: { value: props.initial, save: (value: Value) => latest.current.save(value) },
  })
  return { state: snapshot.value, draft: snapshot.context.draft, error: snapshot.context.error, send }
}
