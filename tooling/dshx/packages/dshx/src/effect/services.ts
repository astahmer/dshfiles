import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type {
  SubprocessHandle,
  SubprocessRuntime,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
  SubprocessTerminalEnvironment,
} from '@deepseek-ai/dsh-subprocess'
import type { SecretCatalogValues, SecretReferenceResolution } from '@dshfiles/credential-port'
import { Context, Effect, Layer, Schema, Scope } from 'effect'
import { HostApiClientModel } from '../api/host-client.js'
import type { AnyApiEventDefinition, AnyApiMethodDefinition, ApiContract } from '../api/types.js'
import { PluginStorageModel } from '../host/plugin-storage.js'
import type { PluginStorage as PromisePluginStorage } from '../host/plugin-storage.js'
import type { CommunicationClient } from '../communication/bridge.js'
import type { SettingsScope } from '../settings/protocol-2.js'
import { effectClient, type EffectApiClient } from './client.js'

export class EffectHostServiceError extends Schema.TaggedError<EffectHostServiceError>()('EffectHostServiceError', {
  service: Schema.Literals(['plugin-storage', 'secret-values', 'subprocess', 'host-api-client', 'communication', 'settings-read']),
  operation: Schema.String,
}) {}

const failed = (
  service: EffectHostServiceError['service'],
  operation: string,
): EffectHostServiceError => new EffectHostServiceError({ service, operation })

export class PluginStorage extends Context.Service<
  PluginStorage,
  {
    get(key: string): Effect.Effect<Awaited<ReturnType<PromisePluginStorage['get']>>, EffectHostServiceError>
    set(key: string, value: Parameters<PromisePluginStorage['set']>[1]): Effect.Effect<Awaited<ReturnType<PromisePluginStorage['set']>>, EffectHostServiceError>
    delete(key: string): Effect.Effect<boolean, EffectHostServiceError>
    list(input?: Parameters<PromisePluginStorage['list']>[0]): Effect.Effect<Awaited<ReturnType<PromisePluginStorage['list']>>, EffectHostServiceError>
  }
>()('@dshfiles/dshx/effect/PluginStorage') {
  static layer(input: { readonly context: CordisContext; readonly namespace: string }) {
    const storage = PluginStorageModel.open(input.context, input.namespace)
    return Layer.succeed(
      PluginStorage,
      PluginStorage.of({
        get: key => Effect.tryPromise({ try: () => storage.get(key), catch: () => failed('plugin-storage', 'get') }),
        set: (key, value) => Effect.tryPromise({ try: () => storage.set(key, value), catch: () => failed('plugin-storage', 'set') }),
        delete: key => Effect.tryPromise({ try: () => storage.delete(key), catch: () => failed('plugin-storage', 'delete') }),
        list: input => Effect.tryPromise({ try: () => storage.list(input), catch: () => failed('plugin-storage', 'list') }),
      }),
    )
  }
}

export class SecretValues extends Context.Service<
  SecretValues,
  {
    resolve(input: SecretReferenceResolution): Effect.Effect<string, EffectHostServiceError>
  }
>()('@dshfiles/dshx/effect/SecretValues') {
  static layer(values: SecretCatalogValues | undefined) {
    if (values === undefined) return Layer.effect(SecretValues, Effect.fail(failed('secret-values', 'resolve')))
    return Layer.succeed(
      SecretValues,
      SecretValues.of({
        resolve: input => Effect.tryPromise({ try: () => values.resolve(input), catch: () => failed('secret-values', 'resolve') }),
      }),
    )
  }
}

type SubprocessPort = Pick<SubprocessRuntime, 'resolveExecutable' | 'terminalEnvironment' | 'spawn' | 'spawnTerminal'>

export class Subprocess extends Context.Service<
  Subprocess,
  {
    resolveExecutable(command: string, env?: Readonly<Record<string, string>>): Effect.Effect<string, EffectHostServiceError>
    terminalEnvironment(): Effect.Effect<SubprocessTerminalEnvironment, EffectHostServiceError>
    spawnScoped(spec: SubprocessSpawnSpec): Effect.Effect<SubprocessHandle, EffectHostServiceError, Scope.Scope>
    spawnTerminalScoped(spec: SubprocessTerminalSpawnSpec): Effect.Effect<SubprocessTerminalHandle, EffectHostServiceError, Scope.Scope>
  }
>()('@dshfiles/dshx/effect/Subprocess') {
  static layer(runtime: SubprocessPort) {
    return Layer.succeed(
      Subprocess,
      Subprocess.of({
        resolveExecutable: (command, env) =>
          Effect.tryPromise({ try: signal => runtime.resolveExecutable(command, env, signal), catch: () => failed('subprocess', 'resolve-executable') }),
        terminalEnvironment: () =>
          Effect.tryPromise({ try: signal => runtime.terminalEnvironment(signal), catch: () => failed('subprocess', 'terminal-environment') }),
        spawnScoped: spec =>
          Effect.acquireRelease(
            Effect.try({ try: () => runtime.spawn(spec), catch: () => failed('subprocess', 'spawn') }),
            handle =>
              Effect.sync(() => handle.terminate()).pipe(
                Effect.andThen(Effect.tryPromise({ try: () => handle.waitForExit(), catch: () => failed('subprocess', 'wait-for-exit') }).pipe(Effect.orDie)),
                Effect.asVoid,
              ),
          ),
        spawnTerminalScoped: spec =>
          Effect.acquireRelease(
            Effect.tryPromise({
              try: signal => runtime.spawnTerminal({ ...spec, signal: spec.signal === undefined ? signal : AbortSignal.any([spec.signal, signal]) }),
              catch: () => failed('subprocess', 'spawn-terminal'),
            }),
            handle => Effect.tryPromise({ try: () => handle.terminate(), catch: () => failed('subprocess', 'terminate-terminal') }).pipe(Effect.orDie),
          ),
      }),
    )
  }
}

export class HostApiClient extends Context.Service<
  HostApiClient,
  {
    make<const Methods extends Record<string, AnyApiMethodDefinition>>(
      contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
      callerPackageId?: string,
    ): EffectApiClient<Methods>
  }
>()('@dshfiles/dshx/effect/HostApiClient') {
  static layer(context: CordisContext) {
    return Layer.succeed(
      HostApiClient,
      HostApiClient.of({
        make: (contract, callerPackageId) => effectClient(HostApiClientModel.create(context, contract, callerPackageId)),
      }),
    )
  }
}

export class Communication extends Context.Service<
  Communication,
  {
    readonly principal: CommunicationClient['principal']
    listAgents(): Effect.Effect<Awaited<ReturnType<CommunicationClient['listAgents']>>, EffectHostServiceError>
    listTopics(): Effect.Effect<Awaited<ReturnType<CommunicationClient['listTopics']>>, EffectHostServiceError>
    diagnostics(input?: Parameters<CommunicationClient['diagnostics']>[0]): Effect.Effect<Awaited<ReturnType<CommunicationClient['diagnostics']>>, EffectHostServiceError>
    subscribe(input: Parameters<CommunicationClient['subscribe']>[0]): Effect.Effect<Awaited<ReturnType<CommunicationClient['subscribe']>>, EffectHostServiceError>
    unsubscribe(topic: Parameters<CommunicationClient['unsubscribe']>[0]): Effect.Effect<Awaited<ReturnType<CommunicationClient['unsubscribe']>>, EffectHostServiceError>
    publish(input: Parameters<CommunicationClient['publish']>[0]): Effect.Effect<Awaited<ReturnType<CommunicationClient['publish']>>, EffectHostServiceError>
    send(input: Parameters<CommunicationClient['send']>[0]): Effect.Effect<Awaited<ReturnType<CommunicationClient['send']>>, EffectHostServiceError>
    inbox(input?: Parameters<CommunicationClient['inbox']>[0]): Effect.Effect<Awaited<ReturnType<CommunicationClient['inbox']>>, EffectHostServiceError>
    acknowledge(messageId: Parameters<CommunicationClient['acknowledge']>[0]): Effect.Effect<Awaited<ReturnType<CommunicationClient['acknowledge']>>, EffectHostServiceError>
  }
>()('@dshfiles/dshx/effect/Communication') {
  static layer(client: CommunicationClient) {
    return Layer.succeed(
      Communication,
      Communication.of({
        principal: client.principal,
        listAgents: () => Effect.tryPromise({ try: () => client.listAgents(), catch: () => failed('communication', 'list-agents') }),
        listTopics: () => Effect.tryPromise({ try: () => client.listTopics(), catch: () => failed('communication', 'list-topics') }),
        diagnostics: input => Effect.tryPromise({ try: () => client.diagnostics(input), catch: () => failed('communication', 'diagnostics') }),
        subscribe: input => Effect.tryPromise({ try: () => client.subscribe(input), catch: () => failed('communication', 'subscribe') }),
        unsubscribe: topic => Effect.tryPromise({ try: () => client.unsubscribe(topic), catch: () => failed('communication', 'unsubscribe') }),
        publish: input => Effect.tryPromise({ try: () => client.publish(input), catch: () => failed('communication', 'publish') }),
        send: input => Effect.tryPromise({ try: () => client.send(input), catch: () => failed('communication', 'send') }),
        inbox: input => Effect.tryPromise({ try: () => client.inbox(input), catch: () => failed('communication', 'inbox') }),
        acknowledge: messageId => Effect.tryPromise({ try: () => client.acknowledge(messageId), catch: () => failed('communication', 'acknowledge') }),
      }),
    )
  }
}

interface SettingsReadShape<Value extends object> {
  get(): Effect.Effect<Value, EffectHostServiceError>
}

export interface SettingsReadTag<Value extends object> extends Context.Service<SettingsReadTag<Value>, SettingsReadShape<Value>> {}

export interface SettingsReadFactory<Value extends object> {
  readonly Tag: SettingsReadTag<Value>
  layer(scope: Pick<SettingsScope<Value>, 'get'>): Layer.Layer<SettingsReadTag<Value>>
}

const makeSettingsRead = <Value extends object>(namespace: string): SettingsReadFactory<Value> => {
  class SettingsReadService extends Context.Service<SettingsReadTag<Value>, SettingsReadShape<Value>>()(
    `@dshfiles/dshx/effect/SettingsRead/${namespace}`,
  ) {}

  return {
    Tag: SettingsReadService,
    layer: (scope: Pick<SettingsScope<Value>, 'get'>) =>
      Layer.succeed(
        SettingsReadService,
        SettingsReadService.of({ get: () => Effect.try({ try: () => scope.get(), catch: () => failed('settings-read', 'get') }) }),
      ),
  }
}

export const SettingsRead = { make: makeSettingsRead }
