import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { errorMessage } from '@dshfiles/plugin-ui/query'

import type { AgentChoice, AgentContinuationSelection, AgentContinuationThread, AgentDispatchOutcome } from './agent-dispatch.js'
import type { ComposerFile } from './composer-files.js'

/**
 * Saving a reply, routing it to an agent and generating an AI answer, as one machine.
 *
 * The saved comment is what shows at send time, so saving comes first and a failed save rolls the composer back;
 * everything after it keeps the reply and says what did not happen. The continuation question a busy agent asks is
 * answered inside the machine, because its promise is awaited by the dispatch the machine started — a dialog flag and
 * a resolver beside that promise were what let the composer show "sending" with no sequence behind it.
 */

const SAVED = 'Your reply was saved'

export interface ContinuationRequest {
  readonly agent: AgentChoice
  readonly threads: readonly AgentContinuationThread[]
}

/** The dispatch half of the reply: one call routes the saved text, one generates the AI answer. */
export interface ReplyDispatch {
  readonly dispatch: (input: { readonly text: string }) => Promise<AgentDispatchOutcome>
  readonly answerReply: (input: { readonly text: string }) => Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>
  readonly smartReplyAnswers: boolean
}

export interface ReplyPorts<File> {
  readonly save: (files: readonly File[]) => Promise<void>
  readonly dispatch: ReplyDispatch | null
  readonly clear: () => void
  readonly restore: (input: { readonly text: string; readonly files: readonly File[] }) => void
  readonly reportFailure: ((message: string) => void) | undefined
  readonly onAnswering: ((answering: boolean) => void) | undefined
}

interface ReplyContext<File> {
  ports: ReplyPorts<File> | null
  text: string
  files: readonly File[]
  failure: string | null
  /** The continuation question the running dispatch is waiting on. */
  continuation: { readonly request: ContinuationRequest; readonly resolve: (selection: AgentContinuationSelection) => void } | null
}

type ReplyEvent<File> =
  | { readonly type: 'SUBMIT'; readonly text: string; readonly files: readonly File[]; readonly ports: ReplyPorts<File> }
  | { readonly type: 'CONTINUATION_REQUEST'; readonly request: ContinuationRequest; readonly resolve: (selection: AgentContinuationSelection) => void }
  | { readonly type: 'CONTINUE'; readonly selection: AgentContinuationSelection }
  | { readonly type: 'CANCEL_CONTINUATION' }
  | { readonly type: 'DISMISS' }

export const createReplyMachine = <File>() =>
  // SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
  setup({
    types: { context: {} as ReplyContext<File>, events: {} as ReplyEvent<File> },
    guards: {
      shouldDispatch: ({ context }) => context.ports?.dispatch !== null && context.ports?.dispatch !== undefined && context.text.trim() !== '',
    },
    actions: {
      startReply: assign(({ event }): Partial<ReplyContext<File>> =>
        event.type === 'SUBMIT' ? { ports: event.ports, text: event.text, files: event.files, failure: null, continuation: null } : {},
      ),
      clearComposer: ({ context }) => context.ports?.clear(),
      restoreInput: ({ context }) => context.ports?.restore({ text: context.text, files: context.files }),
      reportFailure: ({ context }) => {
        if (context.failure !== null) context.ports?.reportFailure?.(context.failure)
      },
      answeringStarted: ({ context }) => context.ports?.onAnswering?.(true),
      answeringEnded: ({ context }) => context.ports?.onAnswering?.(false),
      openContinuation: assign(({ event }): Partial<ReplyContext<File>> =>
        event.type === 'CONTINUATION_REQUEST' ? { continuation: { request: event.request, resolve: event.resolve } } : {},
      ),
      resolveChoice: ({ context, event }) => {
        if (event.type === 'CONTINUE') context.continuation?.resolve(event.selection)
      },
      resolveCancel: ({ context }) => context.continuation?.resolve({ kind: 'cancel' }),
    },
    actors: {
      save: fromPromise<void, { readonly save: ((files: readonly File[]) => Promise<void>) | undefined; readonly files: readonly File[] }>(
        async ({ input }) => {
          if (input.save === undefined) return
          await input.save(input.files)
        },
      ),
      dispatch: fromPromise<
        AgentDispatchOutcome | null,
        { readonly dispatch: ((input: { readonly text: string }) => Promise<AgentDispatchOutcome>) | undefined; readonly text: string }
      >(async ({ input }) => (input.dispatch === undefined ? null : await input.dispatch({ text: input.text }))),
      answer: fromPromise<
        { readonly ok: true } | { readonly ok: false; readonly reason: string },
        {
          readonly answer: ((input: { readonly text: string }) => Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>) | undefined
          readonly text: string
        }
      >(async ({ input }) => (input.answer === undefined ? { ok: true } : await input.answer({ text: input.text }))),
    },
  }).createMachine({
    id: 'reply',
    context: () => ({ ports: null, text: '', files: [], failure: null, continuation: null }),
    initial: 'idle',
    states: {
      idle: {
        on: { SUBMIT: { target: 'saving', actions: ['startReply', 'clearComposer'] } },
      },
      saving: {
        invoke: {
          src: 'save',
          input: ({ context }) => ({ save: context.ports?.save, files: context.files }),
          onDone: [{ guard: 'shouldDispatch', target: 'dispatching' }, { target: 'idle' }],
          onError: {
            target: 'failed',
            actions: ['restoreInput', assign({ failure: ({ event }) => errorMessage(event.error, 'The reply was not saved.') }), 'reportFailure'],
          },
        },
      },
      dispatching: {
        invoke: {
          src: 'dispatch',
          input: ({ context }) => ({ dispatch: context.ports?.dispatch?.dispatch, text: context.text }),
          onDone: [
            {
              guard: ({ context, event }) =>
                event.output !== null &&
                event.output.kind === 'skipped' &&
                event.output.reason === 'reply-only' &&
                context.ports?.dispatch?.smartReplyAnswers === true &&
                context.files.length === 0,
              target: 'answering',
            },
            {
              guard: ({ event }) => event.output !== null && event.output.kind === 'failed',
              target: 'failed',
              actions: [
                assign({
                  failure: ({ event }) =>
                    `${SAVED}, but no thread started: ${event.output !== null && event.output.kind === 'failed' ? event.output.reason : 'the dispatch failed.'}`,
                }),
                'reportFailure',
              ],
            },
            { target: 'idle' },
          ],
          onError: {
            target: 'failed',
            actions: [
              assign({ failure: ({ event }) => `${SAVED}, but it was not sent to an agent: ${errorMessage(event.error, 'The dispatch failed.')}` }),
              'reportFailure',
            ],
          },
        },
        on: {
          CONTINUATION_REQUEST: { actions: 'openContinuation' },
          CONTINUE: { actions: ['resolveChoice', assign({ continuation: null })] },
          CANCEL_CONTINUATION: {
            actions: [assign({ failure: 'Comment saved; no thread was started.' }), 'reportFailure', 'resolveCancel', assign({ continuation: null })],
          },
        },
      },
      answering: {
        entry: 'answeringStarted',
        exit: 'answeringEnded',
        invoke: {
          src: 'answer',
          input: ({ context }) => ({ answer: context.ports?.dispatch?.answerReply, text: context.text }),
          onDone: [
            {
              guard: ({ event }) => !event.output.ok,
              target: 'failed',
              actions: [
                assign({
                  failure: ({ event }) => `${SAVED}, but an AI answer could not be generated: ${event.output.ok ? 'generation failed.' : event.output.reason}`,
                }),
                'reportFailure',
              ],
            },
            { target: 'idle' },
          ],
          onError: {
            target: 'failed',
            actions: [
              assign({ failure: ({ event }) => `${SAVED}, but an AI answer could not be generated: ${errorMessage(event.error, 'Generation failed.')}` }),
              'reportFailure',
            ],
          },
        },
      },
      failed: {
        on: {
          SUBMIT: { target: 'saving', actions: ['startReply', 'clearComposer'] },
          DISMISS: { target: 'idle', actions: assign({ failure: null }) },
        },
      },
    },
  })

/** The machine the backlog reply box runs. */
export const composerReplyMachine = createReplyMachine<ComposerFile>()
