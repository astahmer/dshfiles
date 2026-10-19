import type { SessionWorkspacePathApplication } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SettingsDocumentState } from './native/document-action.js'

import { assign, fromCallback, setup } from '@dshfiles/plugin-ui/machine'

export interface DocumentLocation {
  readonly path: string
  readonly exists: boolean
}

export interface ConfigFileOpeners {
  readonly documentPath: () => Promise<DocumentLocation | null>
  readonly canOpenPaths: () => Promise<boolean>
  readonly applications: (path: string) => Promise<readonly SessionWorkspacePathApplication[] | null>
  readonly openDefault: (path: string) => Promise<boolean>
  readonly openWith: (path: string, applicationId: string) => Promise<boolean>
  readonly reveal: (path: string) => Promise<boolean>
  readonly openInEditor: ((path: string) => boolean) | undefined
}

export interface SettingsDocumentController {
  readonly store: ObservableSnapshot<SettingsDocumentState>
  load(): Promise<void>
  open(): Promise<void>
}

export type OpenConfigFeedback = { readonly kind: 'error'; readonly key: 'config.failed' | 'config.editorNeedsThread' } | { readonly kind: 'copied' } | null

export interface OpenConfigMachineInput {
  readonly controller: SettingsDocumentController
  readonly openers: ConfigFileOpeners
  readonly copyPath: (path: string) => Promise<boolean>
}

interface OpenConfigContext extends OpenConfigMachineInput {
  readonly lookupId: number
  readonly location: DocumentLocation | null
  readonly desktop: boolean | undefined
  readonly apps: readonly SessionWorkspacePathApplication[] | null | undefined
  readonly feedback: OpenConfigFeedback
  readonly pendingAction: PendingMenuAction | null
}

type PendingMenuAction =
  | { readonly kind: 'openWith'; readonly applicationId: string }
  | { readonly kind: 'copy' }
  | { readonly kind: 'reveal' }
  | { readonly kind: 'editor' }

type OpenConfigEvent =
  | { readonly type: 'menu.open' }
  | { readonly type: 'primary' }
  | { readonly type: 'open.with'; readonly applicationId: string }
  | { readonly type: 'copy.path' }
  | { readonly type: 'reveal' }
  | { readonly type: 'open.editor' }
  | { readonly type: 'initial.location'; readonly requestId: number; readonly location: DocumentLocation | null }
  | { readonly type: 'initial.location.failed'; readonly requestId: number }
  | { readonly type: 'initial.desktop'; readonly requestId: number; readonly desktop: boolean }
  | { readonly type: 'initial.desktop.failed'; readonly requestId: number }
  | { readonly type: 'primary.location'; readonly requestId: number; readonly location: DocumentLocation | null }
  | { readonly type: 'primary.desktop'; readonly requestId: number; readonly desktop: boolean }
  | { readonly type: 'primary.finished'; readonly requestId: number; readonly feedback: OpenConfigFeedback }
  | { readonly type: 'menu.location'; readonly requestId: number; readonly location: DocumentLocation | null }
  | { readonly type: 'menu.apps'; readonly requestId: number; readonly apps: readonly SessionWorkspacePathApplication[] | null }
  | { readonly type: 'menu.finished'; readonly requestId: number }
  | { readonly type: 'menu.failed'; readonly requestId: number }
  | { readonly type: 'action.finished'; readonly feedback: OpenConfigFeedback }

interface InitialInput {
  readonly controller: SettingsDocumentController
  readonly openers: ConfigFileOpeners
  readonly requestId: number
}

interface PrimaryInput {
  readonly controller: SettingsDocumentController
  readonly openers: ConfigFileOpeners
  readonly desktop: boolean | undefined
  readonly requestId: number
}

interface MenuInput {
  readonly openers: ConfigFileOpeners
  readonly location: DocumentLocation | null
  readonly desktop: boolean | undefined
  readonly apps: readonly SessionWorkspacePathApplication[] | null | undefined
  readonly requestId: number
}

interface MenuActionInput {
  readonly openers: ConfigFileOpeners
  readonly copyPath: (path: string) => Promise<boolean>
  readonly location: DocumentLocation | null
  readonly pendingAction: PendingMenuAction | null
}

const feedbackDelayMs = 2_500
const failedFeedback: OpenConfigFeedback = { kind: 'error', key: 'config.failed' }

export const openConfigMachine = setup({
  // SAFETY: XState uses empty carriers for inference; runtime values come from the input and typed events.
  types: {
    context: {} as OpenConfigContext,
    events: {} as OpenConfigEvent,
    input: {} as OpenConfigMachineInput,
  },
  delays: { feedbackDelay: feedbackDelayMs },
  actors: {
    initialize: fromCallback<OpenConfigEvent, InitialInput>(({ input, sendBack }) => {
      let active = true
      void Promise.resolve()
        .then(() => (active ? input.controller.load() : undefined))
        .catch(() => undefined)
      void Promise.resolve()
        .then(() => (active ? input.openers.documentPath() : null))
        .then(
          location => {
            if (active) sendBack({ type: 'initial.location', requestId: input.requestId, location })
          },
          () => {
            if (active) sendBack({ type: 'initial.location.failed', requestId: input.requestId })
          },
        )
      void Promise.resolve()
        .then(() => (active ? input.openers.canOpenPaths() : undefined))
        .then(
          desktop => {
            if (active && desktop !== undefined) sendBack({ type: 'initial.desktop', requestId: input.requestId, desktop })
          },
          () => {
            if (active) sendBack({ type: 'initial.desktop.failed', requestId: input.requestId })
          },
        )
      return () => {
        active = false
      }
    }),
    openPrimary: fromCallback<OpenConfigEvent, PrimaryInput>(({ input, sendBack }) => {
      let active = true
      const run = async (): Promise<void> => {
        const location = await input.openers.documentPath()
        if (!active) return
        sendBack({ type: 'primary.location', requestId: input.requestId, location })
        if (location === null || !location.exists) {
          await input.controller.open()
          if (active) sendBack({ type: 'primary.finished', requestId: input.requestId, feedback: null })
          return
        }
        const desktop = input.desktop ?? (await input.openers.canOpenPaths())
        if (!active) return
        if (input.desktop === undefined) sendBack({ type: 'primary.desktop', requestId: input.requestId, desktop })
        if (!desktop) {
          await input.controller.open()
          if (active) sendBack({ type: 'primary.finished', requestId: input.requestId, feedback: null })
          return
        }
        const opened = await input.openers.openDefault(location.path)
        if (active) sendBack({ type: 'primary.finished', requestId: input.requestId, feedback: opened ? null : failedFeedback })
      }
      void run().catch(() => {
        if (active) sendBack({ type: 'primary.finished', requestId: input.requestId, feedback: failedFeedback })
      })
      return () => {
        active = false
      }
    }),
    refreshMenu: fromCallback<OpenConfigEvent, MenuInput>(({ input, sendBack }) => {
      let active = true
      const run = async (): Promise<void> => {
        const location = await input.openers.documentPath()
        if (!active) return
        sendBack({ type: 'menu.location', requestId: input.requestId, location })
        if (location !== null && location.exists && input.desktop === true && input.apps === undefined) {
          let apps: readonly SessionWorkspacePathApplication[] | null
          try {
            apps = await input.openers.applications(location.path)
          } catch {
            apps = null
          }
          if (!active) return
          sendBack({ type: 'menu.apps', requestId: input.requestId, apps })
        }
        if (active) sendBack({ type: 'menu.finished', requestId: input.requestId })
      }
      void run().catch(() => {
        if (active) sendBack({ type: 'menu.failed', requestId: input.requestId })
      })
      return () => {
        active = false
      }
    }),
    performMenuAction: fromCallback<OpenConfigEvent, MenuActionInput>(({ input, sendBack }) => {
      let active = true
      const run = async (): Promise<void> => {
        const path = input.location?.path
        if (path === undefined || input.pendingAction === null) {
          if (active) sendBack({ type: 'action.finished', feedback: failedFeedback })
          return
        }
        let feedback: OpenConfigFeedback = null
        switch (input.pendingAction.kind) {
          case 'openWith':
            if (!(await input.openers.openWith(path, input.pendingAction.applicationId))) feedback = failedFeedback
            break
          case 'copy':
            feedback = (await input.copyPath(path)) ? { kind: 'copied' } : failedFeedback
            break
          case 'reveal':
            if (!(await input.openers.reveal(path))) feedback = failedFeedback
            break
          case 'editor':
            if (input.openers.openInEditor?.(path) !== true) feedback = { kind: 'error', key: 'config.editorNeedsThread' }
            break
        }
        if (active) sendBack({ type: 'action.finished', feedback })
      }
      void run().catch(() => {
        if (active) sendBack({ type: 'action.finished', feedback: failedFeedback })
      })
      return () => {
        active = false
      }
    }),
  },
  guards: {
    hasPath: ({ context }) => context.location !== null,
    hasFeedback: ({ context }) => context.feedback !== null,
    isCurrentLookup: ({ context, event }) => 'requestId' in event && event.requestId === context.lookupId,
  },
  actions: {
    beginLookup: assign(({ context }) => ({ lookupId: context.lookupId + 1 })),
    updateInitialLocation: assign(({ event }) => (event.type === 'initial.location' ? { location: event.location } : {})),
    updateInitialDesktop: assign(({ event }) => (event.type === 'initial.desktop' ? { desktop: event.desktop } : {})),
    updatePrimaryLocation: assign(({ event }) => (event.type === 'primary.location' ? { location: event.location } : {})),
    updatePrimaryDesktop: assign(({ event }) => (event.type === 'primary.desktop' ? { desktop: event.desktop } : {})),
    updateMenuLocation: assign(({ event }) => (event.type === 'menu.location' ? { location: event.location } : {})),
    updateMenuApps: assign(({ event }) => (event.type === 'menu.apps' ? { apps: event.apps } : {})),
    recordInitialFailure: assign(() => ({ feedback: failedFeedback })),
    recordPrimaryResult: assign(({ event }) => (event.type === 'primary.finished' && event.feedback !== null ? { feedback: event.feedback } : {})),
    recordMenuFailure: assign(() => ({ feedback: failedFeedback })),
    queueOpenWith: assign(({ event }) => (event.type === 'open.with' ? { pendingAction: { kind: 'openWith', applicationId: event.applicationId } } : {})),
    queueCopy: assign(() => ({ pendingAction: { kind: 'copy' } })),
    queueReveal: assign(() => ({ pendingAction: { kind: 'reveal' } })),
    queueEditor: assign(() => ({ pendingAction: { kind: 'editor' } })),
    recordMenuAction: assign(({ event }) => {
      if (event.type !== 'action.finished' || event.feedback === null) return { pendingAction: null }
      return { pendingAction: null, feedback: event.feedback }
    }),
    clearFeedback: assign({ feedback: null }),
  },
}).createMachine({
  id: 'openConfig',
  initial: 'active',
  context: ({ input }) => ({ ...input, lookupId: 0, location: null, desktop: undefined, apps: undefined, feedback: null, pendingAction: null }),
  states: {
    active: {
      id: 'openConfigActive',
      initial: 'ready',
      invoke: {
        src: 'initialize',
        input: ({ context }) => ({ controller: context.controller, openers: context.openers, requestId: context.lookupId }),
      },
      on: {
        'initial.location': { guard: 'isCurrentLookup', actions: 'updateInitialLocation' },
        'initial.location.failed': { guard: 'isCurrentLookup', actions: 'recordInitialFailure' },
        'initial.desktop': { guard: 'isCurrentLookup', actions: 'updateInitialDesktop' },
        'initial.desktop.failed': { guard: 'isCurrentLookup', actions: 'recordInitialFailure' },
        'primary.location': { guard: 'isCurrentLookup', actions: 'updatePrimaryLocation' },
        'primary.desktop': { guard: 'isCurrentLookup', actions: 'updatePrimaryDesktop' },
      },
      states: {
        ready: {
          id: 'openConfigReady',
          initial: 'plain',
          on: {
            primary: { target: '#openConfigPrimaryLoading', actions: 'beginLookup' },
            'menu.open': { target: '#openConfigMenuLoading', actions: 'beginLookup' },
            'open.with': [{ guard: 'hasPath', target: '#openConfigMenuAction', actions: 'queueOpenWith' }],
            'copy.path': [{ guard: 'hasPath', target: '#openConfigMenuAction', actions: 'queueCopy' }],
            reveal: [{ guard: 'hasPath', target: '#openConfigMenuAction', actions: 'queueReveal' }],
            'open.editor': [{ guard: 'hasPath', target: '#openConfigMenuAction', actions: 'queueEditor' }],
          },
          states: {
            plain: { always: [{ guard: 'hasFeedback', target: 'feedback' }] },
            feedback: {
              after: { feedbackDelay: { target: 'plain', actions: 'clearFeedback' } },
            },
          },
        },
        primaryLoading: {
          id: 'openConfigPrimaryLoading',
          invoke: {
            src: 'openPrimary',
            input: ({ context }) => ({ controller: context.controller, openers: context.openers, desktop: context.desktop, requestId: context.lookupId }),
          },
          on: {
            'primary.finished': { guard: 'isCurrentLookup', target: '#openConfigReady', actions: 'recordPrimaryResult' },
          },
        },
        menuLoading: {
          id: 'openConfigMenuLoading',
          invoke: {
            src: 'refreshMenu',
            input: ({ context }) => ({
              openers: context.openers,
              location: context.location,
              desktop: context.desktop,
              apps: context.apps,
              requestId: context.lookupId,
            }),
          },
          on: {
            'menu.location': { guard: 'isCurrentLookup', actions: 'updateMenuLocation' },
            'menu.apps': { guard: 'isCurrentLookup', actions: 'updateMenuApps' },
            'menu.finished': { guard: 'isCurrentLookup', target: '#openConfigReady' },
            'menu.failed': { guard: 'isCurrentLookup', target: '#openConfigReady', actions: 'recordMenuFailure' },
          },
        },
        menuAction: {
          id: 'openConfigMenuAction',
          invoke: {
            src: 'performMenuAction',
            input: ({ context }) => ({
              openers: context.openers,
              copyPath: context.copyPath,
              location: context.location,
              pendingAction: context.pendingAction,
            }),
          },
          on: {
            'action.finished': { target: '#openConfigReady', actions: 'recordMenuAction' },
          },
        },
      },
    },
  },
})
