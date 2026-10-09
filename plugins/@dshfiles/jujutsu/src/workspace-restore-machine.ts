import type { ISessions, SessionSummary, SessionWorkspaceRestorePreview, SessionWorkspaceRestoreReceipt } from '@deepseek-ai/dsh-api-session-controller/client'
import { assertEvent, assign, emit, fromPromise, setup } from '@dshfiles/plugin-ui/machine'

type RestoreAction = SessionWorkspaceRestorePreview['action']
type RestoreClient = Pick<ISessions, 'prepareWorkspaceRestore' | 'confirmWorkspaceRestore' | 'workspaceRestoreStatus'>
type SessionId = SessionSummary['id'] | null

interface RestoreContext {
  readonly client: RestoreClient
  readonly workspacePath: string
  readonly targetCommitId: string | null
  readonly sessionId: SessionId
  readonly preview: SessionWorkspaceRestorePreview | null
  readonly receipt: SessionWorkspaceRestoreReceipt | null
  readonly error: string | null
}

type RestoreEvent =
  | { readonly type: 'session.select'; readonly sessionId: SessionId }
  | { readonly type: 'target.change'; readonly workspacePath: string; readonly targetCommitId: string | null }
  | { readonly type: 'prepare'; readonly action: RestoreAction }
  | { readonly type: 'inspect' }
  | { readonly type: 'confirm' }
  | { readonly type: 'preview.close' }

const failureMessage = (error: unknown, fallback: string): string => (error instanceof Error && error.message.length > 0 ? error.message : fallback)

const unwrap = <Value>(result: { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: { readonly message: string } }): Value => {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const requireSession = (sessionId: SessionId): SessionSummary['id'] => {
  if (sessionId === null) throw new Error('Choose a Session first.')
  return sessionId
}

const cleared = { preview: null, receipt: null, error: null } as const

/** select → prepare → confirm → receipt. Leaving a busy state stops its actor, which aborts the Host call. */
export const workspaceRestoreMachine = setup({
  types: {
    context: {} as RestoreContext,
    events: {} as RestoreEvent,
    input: {} as Pick<RestoreContext, 'client' | 'workspacePath' | 'targetCommitId'>,
    emitted: {} as { readonly type: 'restored' },
  },
  actors: {
    prepare: fromPromise<SessionWorkspaceRestorePreview, { readonly context: RestoreContext; readonly action: RestoreAction }>(async ({ input, signal }) => {
      const preview = unwrap(
        await input.context.client.prepareWorkspaceRestore(
          {
            sessionId: requireSession(input.context.sessionId),
            action: input.action,
            ...(input.action === 'restore' ? { targetCommitId: input.context.targetCommitId ?? undefined } : {}),
          },
          signal,
        ),
      )
      if (preview.workspacePath !== input.context.workspacePath) {
        throw new Error(`The selected Session belongs to ${preview.workspacePath}; this repository is ${input.context.workspacePath}.`)
      }
      return preview
    }),
    confirm: fromPromise<SessionWorkspaceRestoreReceipt, { readonly client: RestoreClient; readonly previewId: string }>(async ({ input, signal }) =>
      unwrap(await input.client.confirmWorkspaceRestore({ previewId: input.previewId }, signal)),
    ),
    inspect: fromPromise<SessionWorkspaceRestoreReceipt | null, { readonly client: RestoreClient; readonly sessionId: SessionId }>(async ({ input, signal }) =>
      unwrap(await input.client.workspaceRestoreStatus({ sessionId: requireSession(input.sessionId) }, signal)),
    ),
  },
  guards: {
    canPrepare: ({ context, event }) =>
      event.type === 'prepare' && context.sessionId !== null && (event.action !== 'restore' || context.targetCommitId !== null),
    hasSession: ({ context }) => context.sessionId !== null,
    hasPreview: ({ context }) => context.preview !== null,
  },
}).createMachine({
  id: 'workspaceRestore',
  context: ({ input }) => ({ ...input, sessionId: null, ...cleared }),
  initial: 'idle',
  on: {
    'session.select': { target: '.idle', actions: assign(({ event }) => ({ sessionId: event.sessionId, ...cleared })) },
    'target.change': {
      target: '.idle',
      actions: assign(({ event }) => ({ workspacePath: event.workspacePath, targetCommitId: event.targetCommitId, ...cleared })),
    },
  },
  states: {
    idle: {
      on: {
        prepare: { guard: 'canPrepare', target: 'preparing' },
        inspect: { guard: 'hasSession', target: 'inspecting' },
      },
    },
    preparing: {
      tags: ['busy'],
      entry: assign({ preview: null, error: null }),
      invoke: {
        src: 'prepare',
        input: ({ context, event }) => {
          assertEvent(event, 'prepare')
          return { context, action: event.action }
        },
        onDone: { target: 'previewing', actions: assign(({ event }) => ({ preview: event.output, receipt: null })) },
        onError: { target: 'idle', actions: assign(({ event }) => ({ error: failureMessage(event.error, 'Could not prepare the filesystem restore.') })) },
      },
    },
    previewing: {
      on: {
        confirm: 'confirming',
        'preview.close': { target: 'idle', actions: assign({ preview: null }) },
        prepare: { guard: 'canPrepare', target: 'preparing' },
        inspect: { guard: 'hasSession', target: 'inspecting' },
      },
    },
    confirming: {
      tags: ['busy'],
      entry: assign({ error: null }),
      on: { 'preview.close': { actions: assign({ preview: null }) } },
      invoke: {
        src: 'confirm',
        input: ({ context }) => ({ client: context.client, previewId: context.preview?.previewId ?? '' }),
        onDone: { target: 'idle', actions: [assign(({ event }) => ({ receipt: event.output, preview: null })), emit({ type: 'restored' })] },
        onError: [
          {
            guard: 'hasPreview',
            target: 'previewing',
            actions: assign(({ event }) => ({ error: failureMessage(event.error, 'Could not confirm the filesystem restore.') })),
          },
          { target: 'idle', actions: assign(({ event }) => ({ error: failureMessage(event.error, 'Could not confirm the filesystem restore.') })) },
        ],
      },
    },
    inspecting: {
      tags: ['busy'],
      entry: assign({ preview: null, error: null }),
      invoke: {
        src: 'inspect',
        input: ({ context }) => ({ client: context.client, sessionId: context.sessionId }),
        onDone: [
          { guard: ({ event }) => event.output !== null, target: 'idle', actions: [assign(({ event }) => ({ receipt: event.output })), emit({ type: 'restored' })] },
          { target: 'idle', actions: assign({ receipt: null }) },
        ],
        onError: { target: 'idle', actions: assign(({ event }) => ({ error: failureMessage(event.error, 'Could not inspect the latest filesystem restore.') })) },
      },
    },
  },
})
