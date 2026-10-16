import type { BuiltInLocaleId as LocaleId } from '@deepseek-ai/dsh-client-locale/client'
import type { LocaleNamespaceMap } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocaleDefinition, LocaleDictionaries } from './types.js'

export interface LocaleDefinitionParts {
  readonly namespace: string
  readonly dictionaries: LocaleDictionaries
}

const localeDefinitions = new WeakMap<object, LocaleDefinitionParts>()

type DictionaryKeys<Dictionaries extends LocaleDictionaries> = {
  [Id in LocaleId]: keyof Dictionaries[Id]
}[LocaleId] &
  string

type BalancedDictionaries<Dictionaries extends LocaleDictionaries> = Dictionaries &
  Record<Exclude<keyof Dictionaries, LocaleId>, never> & {
    readonly [Id in LocaleId]: Dictionaries[Id] & Record<Exclude<DictionaryKeys<Dictionaries>, keyof Dictionaries[Id]>, never>
  }

/**
 * Declare one locale namespace so a slot's `locale:` field accepts it.
 *
 * `SlotOptions.locale` is constrained to `keyof LocaleNamespaceMap`, which is an
 * open interface every package extends by declaration merging. A namespace
 * cannot be added any other way, so this helper emits the merge for you and keeps
 * the key union in sync with the dictionary you pass.
 *
 * ```ts
 * export const locale = declareLocaleNamespace('my.plugin', { en, zh })
 * ```
 *
 * Calling it is the whole ceremony: the returned `defineLocale` definition is
 * still what the Client registers.
 */
function declareLocaleNamespace<const Namespace extends string, const Dictionaries extends LocaleDictionaries>(
  namespace: Namespace & UnreservedNamespace<Namespace>,
  dictionaries: BalancedDictionaries<Dictionaries>,
): LocaleDefinition<Namespace, DictionaryKeys<Dictionaries>> {
  registerLocaleNamespace<Namespace, DictionaryKeys<Dictionaries>>(dictionaries)
  return defineLocale<Namespace, Dictionaries>(namespace, dictionaries)
}

/**
 * Widen the namespace map by one plugin's keys. The augmentation is emitted
 * through a helper because a bare `declare module` in a plugin is easy to omit
 * and then fails much later, at the slot that uses the namespace.
 */
const registerLocaleNamespace = <Namespace extends string, Key extends string>(
  _dictionaries: BalancedDictionaries<Record<LocaleId, Record<Key, string>>>,
): void => {
  type Merged = Namespace extends keyof LocaleNamespaceMap ? LocaleNamespaceMap[Namespace] : never
  type Declared = Exclude<Merged, Key> | Key
  augmentLocaleNamespace<Namespace, Declared>()
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Populated by `declareLocaleNamespace`; see the note on `SlotOptions.locale`. */
    [namespace: string]: string
  }
}

const augmentLocaleNamespace = <_Namespace extends string, _Key extends string>(): void => {}

/** Namespaces shipped packages own outright, refused here and by the build check. */
export type ReservedLocaleNamespace = 'conversation' | 'settings'

type UnreservedNamespace<Namespace extends string> = Namespace extends ReservedLocaleNamespace ? never : Namespace

/**
 * Define one type-safe namespace without requiring LocaleNamespaceMap declaration merging.
 *
 * A reserved namespace is a type error here because the Locale runtime keeps one
 * dictionary per namespace and locale for the whole client, so no profile may
 * claim one a shipped package already registers. The build repeats the check for
 * namespaces that are not literal at the type level.
 */
function defineLocale<Namespace extends string, const Dictionaries extends LocaleDictionaries>(
  namespace: Namespace & UnreservedNamespace<Namespace>,
  dictionaries: BalancedDictionaries<Dictionaries>,
): LocaleDefinition<Namespace, DictionaryKeys<Dictionaries>> {
  const definition = {} as LocaleDefinition<Namespace, DictionaryKeys<Dictionaries>>
  localeDefinitions.set(definition, { namespace, dictionaries })
  return definition
}

function isLocaleDefinition(value: unknown): value is LocaleDefinition {
  return typeof value === 'object' && value !== null && localeDefinitions.has(value)
}

function localeDefinitionParts(value: LocaleDefinition): LocaleDefinitionParts {
  const parts = localeDefinitions.get(value)
  if (parts === undefined) throw new TypeError('Invalid Locale contribution; create it with defineLocale(namespace, dictionaries).')
  return parts
}

export class LocaleNamespaceModel {
  static readonly declareNamespace = declareLocaleNamespace
  static readonly define = defineLocale
  static readonly isDefinition = isLocaleDefinition
  static readonly parts = localeDefinitionParts
}
