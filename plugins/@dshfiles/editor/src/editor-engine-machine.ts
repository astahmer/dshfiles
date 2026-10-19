import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { CodeEditorEngine } from './code-editor.js'

interface EditorEngineLoaderInput {
  readonly loadEngine: () => Promise<CodeEditorEngine>
}

interface EditorEngineLoaderContext extends EditorEngineLoaderInput {
  readonly engine: CodeEditorEngine | null
}

type EditorEngineLoaderEvent = { readonly type: 'activate' } | { readonly type: 'deactivate' } | { readonly type: 'create.failed' }

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
}).createMachine({
  id: 'editorEngineLoader',
  initial: 'idle',
  context: ({ input }) => ({ ...input, engine: null }),
  states: {
    idle: {
      on: { activate: 'loading' },
    },
    loading: {
      invoke: {
        src: 'loadEngine',
        input: ({ context }: { readonly context: EditorEngineLoaderContext }) => ({ loadEngine: context.loadEngine }),
        onDone: {
          target: 'ready',
          actions: assign(({ event }) => ({ engine: event.output })),
        },
        onError: { target: 'error' },
      },
      on: { deactivate: 'idle' },
    },
    ready: {
      on: { 'create.failed': 'error' },
    },
    error: {
      on: { deactivate: 'idle' },
    },
  },
})
