import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { CodeEditorEngine } from './code-editor.js'

interface EditorEngineLoaderInput {
  readonly loadEngine: () => Promise<CodeEditorEngine>
}

interface EditorEngineLoaderContext extends EditorEngineLoaderInput {
  readonly engine: CodeEditorEngine | null
  readonly loadStartedAt: number | null
}

type EditorEngineLoaderEvent = { readonly type: 'editable.changed'; readonly editable: boolean } | { readonly type: 'create.failed' }

export const editorEngineLoaderMachine = setup({
  // SAFETY: XState uses empty carriers for inference; runtime context comes from input and events are sent by the panel.
  types: {
    context: {} as EditorEngineLoaderContext,
    events: {} as EditorEngineLoaderEvent,
    input: {} as EditorEngineLoaderInput,
  },
  actors: {
    loadEngine: fromPromise<CodeEditorEngine, EditorEngineLoaderInput>(({ input }) => input.loadEngine()),
  },
  guards: {
    editable: ({ event }) => event.type === 'editable.changed' && event.editable,
    notEditable: ({ event }) => event.type === 'editable.changed' && !event.editable,
  },
}).createMachine({
  id: 'editorEngineLoader',
  initial: 'idle',
  context: ({ input }) => ({ ...input, engine: null, loadStartedAt: null }),
  states: {
    idle: {
      on: { 'editable.changed': { guard: 'editable', target: 'loading' } },
    },
    loading: {
      entry: assign(() => ({ loadStartedAt: performance.now() })),
      invoke: {
        src: 'loadEngine',
        input: ({ context }: { readonly context: EditorEngineLoaderContext }) => ({ loadEngine: context.loadEngine }),
        onDone: {
          target: 'ready',
          actions: assign(({ event }) => ({ engine: event.output })),
        },
        onError: { target: 'error' },
      },
      on: { 'editable.changed': { guard: 'notEditable', target: 'idle' } },
    },
    ready: {
      on: { 'create.failed': 'error' },
    },
    error: {
      on: { 'editable.changed': { guard: 'notEditable', target: 'idle' } },
    },
  },
})
