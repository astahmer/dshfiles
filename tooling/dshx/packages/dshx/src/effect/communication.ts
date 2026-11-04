import { Context, Duration, Effect, Layer, Option, Schedule, Schema, Stream } from 'effect'
import { connectCommunicationClient, type CommunicationClient, type ConnectCommunicationClientOptions } from '../communication/bridge.js'
import type { CommunicationMessage } from '../communication/types.js'

const communicationOperations = ['listAgents', 'listTopics', 'diagnostics', 'subscribe', 'unsubscribe', 'publish', 'send', 'inbox', 'acknowledge'] as const

type CommunicationOperation = (typeof communicationOperations)[number]

const ErrorCode = Schema.Struct({ code: Schema.String })

/** A communication bridge call failed; `code` is the bridge's error code when it answered with one. */
export class CommunicationFailed extends Schema.TaggedError<CommunicationFailed>()('CommunicationFailed', {
  operation: Schema.Literals([...communicationOperations, 'connect']),
  code: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Agent communication ${this.operation} failed${this.code === undefined ? '' : ` (${this.code})`}. Check that DSH is running with the agent-communication plugin.`
  }
}

const failed = (operation: CommunicationFailed['operation']) => (cause: unknown) =>
  new CommunicationFailed({ operation, code: Option.getOrUndefined(Schema.decodeUnknownOption(ErrorCode)(cause))?.code, cause })

/** Every Promise method of `Client` named in `Keys`, as an Effect failing with `E`. */
export type LiftedClient<Client, Keys extends keyof Client, E> = {
  readonly [K in Keys]: Client[K] extends (...args: infer Args) => Promise<infer Result> ? (...args: Args) => Effect.Effect<Result, E> : never
}

/** Turn the named Promise methods of a client into traced Effect methods with one typed failure. */
export const liftPromiseClient = <Client, const Keys extends ReadonlyArray<keyof Client & string>, E>(input: {
  readonly subject: string
  readonly client: Client
  readonly operations: Keys
  readonly onError: (operation: Keys[number], cause: unknown) => E
}): LiftedClient<Client, Keys[number], E> => {
  const call = (operation: Keys[number]) => {
    const method: unknown = input.client[operation]
    return Effect.fn(`${input.subject} ${operation}`)(function* (...args: ReadonlyArray<unknown>) {
      return yield* Effect.tryPromise({
        try: () => (typeof method === 'function' ? method.apply(input.client, args) : Promise.reject(new TypeError(`${operation} is not a method.`))),
        catch: cause => input.onError(operation, cause),
      })
    })
  }
  // SAFETY: every listed key maps to the traced call of the same Promise method, which is what LiftedClient states.
  return Object.fromEntries(input.operations.map(operation => [operation, call(operation)])) as unknown as LiftedClient<Client, Keys[number], E>
}

export interface CommunicationInboxOptions {
  readonly topic?: string
  /** How often the bridge is asked for new messages; it has no push channel. */
  readonly every: Duration.Input
}

/** The DSH agent-communication bridge as an Effect service. */
export class Communication extends Context.Service<
  Communication,
  LiftedClient<CommunicationClient, CommunicationOperation, CommunicationFailed> & {
    readonly principal: CommunicationClient['principal']
    /** Each unacknowledged inbox message once, polled on a schedule; acknowledge a message to drop it from the inbox. */
    readonly messages: (options: CommunicationInboxOptions) => Stream.Stream<CommunicationMessage, CommunicationFailed>
  }
>()('@dshfiles/dshx/Communication') {
  /** Connect to the running Host's communication bridge. */
  static readonly layer = (options: ConnectCommunicationClientOptions = {}) =>
    Layer.effect(
      Communication,
      Effect.tryPromise({ try: () => connectCommunicationClient(options), catch: failed('connect') }).pipe(Effect.map(makeCommunication)),
    )

  /** Use an already connected client. */
  static readonly fromClient = (client: CommunicationClient) => Layer.succeed(Communication, makeCommunication(client))
}

const makeCommunication = (client: CommunicationClient) => {
  const lifted = liftPromiseClient({
    subject: 'communication',
    client,
    operations: communicationOperations,
    onError: (operation, cause) => failed(operation)(cause),
  })
  return Communication.of({
    ...lifted,
    principal: client.principal,
    messages: options =>
      Stream.fromEffectSchedule(
        lifted.inbox(options.topic === undefined ? {} : { topic: options.topic }),
        Schedule.spaced(Duration.fromInputUnsafe(options.every)),
      ).pipe(
        Stream.mapAccum(
          (): ReadonlySet<string> => new Set(),
          (seen, inbox) => {
            const fresh = inbox.items.filter(message => !seen.has(message.id))
            return [new Set(inbox.items.map(message => message.id)), fresh]
          },
        ),
      ),
  })
}
