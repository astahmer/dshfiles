import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Schema } from 'effect'

/** The DSH credential store is not loaded, or refused a read or write. */
export class DshCredentialsError extends Schema.TaggedError<DshCredentialsError>()('DshCredentialsError', {
  operation: Schema.Literals(['unavailable', 'describe', 'set']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    if (this.operation === 'unavailable') return 'The DSH credential store is unavailable.'
    if (this.operation === 'describe') return 'The DSH credential store could not be checked.'
    return 'The selected key could not be stored in DSH credentials.'
  }
}

type CredentialStore = Pick<CredentialProvider, 'describe' | 'set'>

const storeOver = (current: () => CredentialStore | undefined) => {
  const store = Effect.suspend(() => {
    const credentials = current()
    return credentials === undefined ? Effect.fail(new DshCredentialsError({ operation: 'unavailable' })) : Effect.succeed(credentials)
  })
  return DshCredentials.of({
    describe: ref =>
      Effect.flatMap(store, credentials =>
        Effect.tryPromise({ try: () => credentials.describe(credentialRef(ref)), catch: cause => new DshCredentialsError({ operation: 'describe', cause }) }),
      ),
    set: (ref, value) =>
      Effect.flatMap(store, credentials =>
        Effect.tryPromise({ try: () => credentials.set(credentialRef(ref), value), catch: cause => new DshCredentialsError({ operation: 'set', cause }) }),
      ),
  })
}

/** DSH's write-only credential store, read from the Host per call because it may load after this plugin. */
export class DshCredentials extends Context.Service<
  DshCredentials,
  {
    readonly describe: (ref: string) => Effect.Effect<{ readonly configured: boolean; readonly writable: boolean }, DshCredentialsError>
    readonly set: (ref: string, value: string) => Effect.Effect<void, DshCredentialsError>
  }
>()('@dshfiles/secret-catalog/DshCredentials') {
  static readonly layer = Layer.effect(
    DshCredentials,
    Effect.map(HostContext, host => storeOver(() => host.ctx.get('credentials'))),
  )

  /** A credential store standing in for DSH's in tests. */
  static readonly layerTest = (store: CredentialStore | undefined) =>
    Layer.succeed(
      DshCredentials,
      storeOver(() => store),
    )
}
