import type { LocaleNamespaceMap, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocaleDefinition, LocaleDictionaries, LocaleSourceDictionaries, PluralBaseOf } from './types.js'

export interface LocaleDefinitionParts {
  readonly namespace: string
  readonly dictionaries: LocaleSourceDictionaries
}

export interface LocaleRegistration {
  readonly builtIn: LocaleDictionaries
  readonly additional: readonly { readonly locale: string; readonly dictionary: Readonly<Record<string, string>> }[]
}

const localeDefinitions = new WeakMap<object, LocaleDefinitionParts>()

type DictionaryKeys<Dictionaries extends LocaleSourceDictionaries> = keyof Dictionaries['en'] & string

type FallbackDictionaries<Dictionaries extends LocaleSourceDictionaries> = Dictionaries & {
  readonly [Id in Exclude<keyof Dictionaries, 'en'>]: Dictionaries[Id] & Record<Exclude<keyof Dictionaries[Id], DictionaryKeys<Dictionaries>>, never>
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
function declareLocaleNamespace<const Namespace extends string, const Dictionaries extends LocaleSourceDictionaries>(
  namespace: Namespace & UnreservedNamespace<Namespace>,
  dictionaries: FallbackDictionaries<Dictionaries>,
): LocaleDefinition<Namespace, DictionaryKeys<Dictionaries>> {
  registerLocaleNamespace<Namespace, DictionaryKeys<Dictionaries>>()
  return defineLocale<Namespace, Dictionaries>(namespace, dictionaries)
}

/**
 * Widen the namespace map by one plugin's keys. The augmentation is emitted
 * through a helper because a bare `declare module` in a plugin is easy to omit
 * and then fails much later, at the slot that uses the namespace.
 */
const registerLocaleNamespace = <Namespace extends string, Key extends string>(): void => {
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
function defineLocale<Namespace extends string, const Dictionaries extends LocaleSourceDictionaries>(
  namespace: Namespace & UnreservedNamespace<Namespace>,
  dictionaries: FallbackDictionaries<Dictionaries>,
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

/** The native provider needs complete zh and en dictionaries, so every locale is filled from English. */
const localeRegistration = (dictionaries: LocaleSourceDictionaries): LocaleRegistration => {
  const withEnglishFallback = (dictionary: Readonly<Record<string, string>> | undefined) => ({ ...dictionaries.en, ...dictionary })
  return {
    builtIn: { en: dictionaries.en, zh: withEnglishFallback(dictionaries.zh) },
    additional: Object.entries(dictionaries)
      .filter(([locale]) => locale !== 'en' && locale !== 'zh')
      .map(([locale, dictionary]) => ({ locale, dictionary: withEnglishFallback(dictionary) })),
  }
}

const pluralRulesByLocale = new Map<string, Intl.PluralRules>()

const pluralRulesFor = (locale: string): Intl.PluralRules => {
  const cached = pluralRulesByLocale.get(locale)
  if (cached !== undefined) return cached
  const rules = new Intl.PluralRules(locale)
  pluralRulesByLocale.set(locale, rules)
  return rules
}

/** The native Locale provider mirrors its active locale onto `<html lang>`; `t` itself does not expose it. */
const activeLocale = (): string => (typeof document === 'undefined' || document.documentElement.lang === '' ? 'en' : document.documentElement.lang)

/**
 * Translate a plural key: picks `key_zero` (count 0, when present), then the
 * `Intl.PluralRules` category variant such as `key_one`, then `key_other`.
 * `{count}` and every other param interpolate through the native `t`.
 */
const plural = <Key extends string>(t: Translate<Key>, key: PluralBaseOf<Key>, count: number, params?: Parameters<Translate>[1]): string => {
  // SAFETY: variant keys are built at runtime; `PluralBaseOf<Key>` guarantees `key_other` is in the key union.
  const translate = t as Translate
  const values = { ...params, count }
  const variant = (category: string): string | undefined => {
    const variantKey = `${key}_${category}`
    const text = translate(variantKey, values)
    return text === variantKey ? undefined : text
  }
  const zero = count === 0 ? variant('zero') : undefined
  return zero ?? variant(pluralRulesFor(activeLocale()).select(count)) ?? translate(`${key}_other`, values)
}

export class LocaleNamespaceModel {
  static readonly declareNamespace = declareLocaleNamespace
  static readonly define = defineLocale
  static readonly isDefinition = isLocaleDefinition
  static readonly parts = localeDefinitionParts
  static readonly registration = localeRegistration
  static readonly plural = plural
  static readonly active = activeLocale
}
