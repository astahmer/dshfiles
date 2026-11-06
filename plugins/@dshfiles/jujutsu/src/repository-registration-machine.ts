import { assign, emit, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { shouldReregisterRepository } from './repository-loading.js'

export interface RegisteredRepository {
  readonly repoId: string
  readonly root: string
}

export interface RepositoryRegistrationClient {
  readonly register: (input: { readonly path: string; readonly readOnly: boolean }, options: { readonly signal: AbortSignal }) => Promise<RegisteredRepository>
}

interface RepositoryRegistrationRequest {
  readonly path: string
  readonly readOnly: boolean
}

interface RepositoryRegistrationContext {
  readonly client: RepositoryRegistrationClient
  readonly request: RepositoryRegistrationRequest | null
  readonly path: string | null
  readonly repoId: string | null
  readonly root: string | null
  readonly error: string | null
  readonly recoveredPath: string | null
}

interface RepositoryRegistrationInput {
  readonly client: RepositoryRegistrationClient
  readonly path: string | null
}

type RepositoryRegistrationEvent =
  | { readonly type: 'register'; readonly path: string; readonly readOnly?: boolean }
  | { readonly type: 'recover'; readonly path: string }
  | { readonly type: 'state.loaded' }
  | { readonly type: 'clear.error' }

interface RepositoryRegistrationEmitted {
  readonly type: 'registered'
  readonly repo: RegisteredRepository
}

/** xstate reads this as type declarations only; nothing in it exists at runtime. */
interface RepositoryRegistrationMachineTypes {
  readonly context: RepositoryRegistrationContext
  readonly events: RepositoryRegistrationEvent
  readonly input: RepositoryRegistrationInput
  readonly emitted: RepositoryRegistrationEmitted
}

const requested = (event: { readonly path: string; readonly readOnly?: boolean }): Partial<RepositoryRegistrationContext> => ({
  request: { path: event.path, readOnly: event.readOnly === true },
  repoId: null,
  root: null,
  error: null,
})

const settled = (repo: RegisteredRepository): Partial<RepositoryRegistrationContext> => ({
  request: null,
  path: repo.root,
  repoId: repo.repoId,
  root: repo.root,
  error: null,
})

const alreadyRegistered = (context: RepositoryRegistrationContext, path: string): boolean =>
  context.repoId !== null && context.path === path && context.request === null

/**
 * unregistered → registering → registered, with a single read-only retry when the Host restarted and lost the
 * in-memory repository id. One context holds the active path, id and error, so a superseded registration can never
 * publish its repository after a newer one.
 */
export const repositoryRegistrationMachine = setup({
  // SAFETY: xstate's `types` reads these declarations only; the cast object is never evaluated.
  types: {} as RepositoryRegistrationMachineTypes,
  actors: {
    register: fromPromise<RegisteredRepository, { readonly client: RepositoryRegistrationClient; readonly request: RepositoryRegistrationRequest }>(
      ({ input, signal }) => input.client.register(input.request, { signal }),
    ),
  },
  guards: {
    shouldRegister: ({ context, event }) =>
      event.type === 'register' &&
      event.path.trim().length > 0 &&
      !alreadyRegistered(context, event.path) &&
      !(context.request?.path === event.path && context.request.readOnly === (event.readOnly === true)),
    shouldRecover: ({ context, event }) =>
      event.type === 'recover' &&
      shouldReregisterRepository({ hasError: true, repoId: context.repoId, path: event.path, recoveredPath: context.recoveredPath }),
  },
}).createMachine({
  id: 'repositoryRegistration',
  context: ({ input }) => ({
    client: input.client,
    request: null,
    path: input.path,
    repoId: null,
    root: null,
    error: null,
    recoveredPath: null,
  }),
  initial: 'unregistered',
  on: {
    register: {
      guard: 'shouldRegister',
      target: '.registering',
      actions: assign(({ context, event }) => ({
        ...requested(event),
        path: event.path,
        recoveredPath: context.recoveredPath === event.path ? null : context.recoveredPath,
      })),
    },
    'state.loaded': { actions: assign({ recoveredPath: null }) },
    'clear.error': { actions: assign({ error: null }) },
  },
  states: {
    unregistered: {},
    registering: {
      tags: ['busy'],
      invoke: {
        src: 'register',
        input: ({ context }) => {
          if (context.request === null) throw new Error('No repository registration is active.')
          return { client: context.client, request: context.request }
        },
        onDone: {
          target: 'registered',
          actions: [assign(({ event }) => settled(event.output)), emit(({ event }) => ({ type: 'registered', repo: event.output }) as const)],
        },
        onError: {
          target: 'failed',
          actions: assign(({ event }) => ({ request: null, error: errorMessage(event.error, 'Could not register this repository.') })),
        },
      },
    },
    registered: {
      on: {
        recover: {
          guard: 'shouldRecover',
          target: 'recovering',
          actions: assign(({ event }) => ({ request: { path: event.path, readOnly: true }, recoveredPath: event.path, error: null })),
        },
      },
    },
    recovering: {
      tags: ['busy'],
      invoke: {
        src: 'register',
        input: ({ context }) => {
          if (context.request === null) throw new Error('No repository registration is active.')
          return { client: context.client, request: context.request }
        },
        onDone: {
          target: 'registered',
          actions: [assign(({ event }) => settled(event.output)), emit(({ event }) => ({ type: 'registered', repo: event.output }) as const)],
        },
        onError: {
          target: 'failed',
          actions: assign(({ event }) => ({ request: null, error: errorMessage(event.error, 'Could not register this repository.') })),
        },
      },
    },
    failed: {},
  },
})
