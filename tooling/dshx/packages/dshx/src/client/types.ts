import type { Context, Effect } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { BuiltInLocaleId } from '@deepseek-ai/dsh-client-locale/client'
import type {
  ChildrenDecl,
  CommonKeyOf,
  ComposedProps,
  EntryKeyOf,
  HandleOf,
  InjectParams,
  KindOptions,
  LocaleNamespaceMap,
  SlotComponent,
  SlotMap,
  StoreDecl,
  Translate,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationContribution } from '../conversation/types.js'
import type { PluginContext } from './plugin-context.js'
import type { SettingsSectionMetadata } from '../settings/section-entries.js'

declare const slotContributionBrand: unique symbol
declare const localeDefinitionBrand: unique symbol

type LocaleDictionary = Readonly<Record<string, string>>

/** Client service contracts that replace same-named Host services in Cordis Context. */
export interface ClientServiceMap {
  readonly sessions: ISessions
  readonly modelDirectories: ModelDirectoryResolver
}

export type ClientContext = Omit<Context, keyof ClientServiceMap> & ClientServiceMap

/** Complete set of dictionaries accepted by the official zh/en Locale provider. */
export type LocaleDictionaries = Readonly<Record<BuiltInLocaleId, LocaleDictionary>>

/**
 * Dictionaries accepted by defineLocale(): `en` is complete and defines the key
 * union; every other locale id may be partial and falls back to English.
 */
export type LocaleSourceDictionaries = { readonly en: LocaleDictionary } & { readonly [locale: string]: LocaleDictionary }

/** Opaque declarative Locale contribution consumed by the Client adapter. */
export interface LocaleDefinition<Namespace extends string = string, Key extends string = string> {
  readonly [localeDefinitionBrand]: {
    readonly namespace: Namespace
    readonly key: Key
  }
}

/** Dictionary key union retained by a defineLocale() contribution. */
export type LocaleKeyOf<Definition extends LocaleDefinition> = Definition extends LocaleDefinition<string, infer Key> ? Key : never

export type PluralBaseOf<Key extends string> = Key extends `${infer Base}_other` ? Base : never

/** Plural base keys of a defineLocale() contribution: every `key` with a `key_other` variant. */
export type PluralKeyOf<Definition extends LocaleDefinition> = PluralBaseOf<LocaleKeyOf<Definition>>

/** Locale prop injected by a Slot that references a defineLocale() contribution. */
export type PropsLocaleOf<Definition extends LocaleDefinition> = {
  readonly t: Translate<LocaleKeyOf<Definition> | CommonKeyOf>
}

export type ClientConversationContribution = ConversationContribution

/**
 * Wrap a component so it can read this package's `useApi`/`useSettings` context.
 *
 * A component registered through `slots: [defineSlot(...)]` is decorated
 * automatically. A component registered imperatively from `setup(ctx, decorate)`
 * is not, and calling a capability hook in it throws
 * `API "…" is unavailable outside a DSHX Client Slot component` on first
 * render. Pass such a component through this helper at registration.
 *
 * The signature stays opaque because the decorator erases the component's own
 * prop type and hands the framework its own; narrowing it would reject valid
 * registrations rather than catch a mistake.
 */
export type ClientComponentDecorator = <Component>(component: Component) => Component

export interface ClientDefinition {
  readonly name?: string
  readonly inject?: readonly string[]
  readonly locales?: readonly LocaleDefinition[]
  readonly conversations?: readonly ClientConversationContribution[]
  readonly slots?: readonly SlotContribution[]
  /** `metadata.plugin` is this plugin's context: `add`, `provide`, `use`, dialogs, toasts, commands and layout. */
  readonly setup?: (
    ctx: ClientContext,
    decorate: ClientComponentDecorator,
    metadata?: { readonly packageId: string; readonly plugin?: PluginContext },
  ) => void | Effect<void>
}

type RendersCheck<C, D> = [keyof D & keyof SlotMap & string] extends [never]
  ? unknown
  : C extends (props: infer P) => unknown
    ? 'renderSlot' extends keyof P
      ? unknown
      : 'renderSlotChain' extends keyof P
        ? unknown
        : {
            'children declared but the component consumes no renderSlot': keyof D & keyof SlotMap & string
          }
    : unknown

/** Official Slot registration options, including store-handle normalization and child-render checks. */
export type SlotOptions<
  K extends keyof SlotMap & string,
  EntryKey extends EntryKeyOf<K> = EntryKeyOf<K>,
  D extends ChildrenDecl = Record<never, never>,
  H extends StoreDecl | undefined = undefined,
  I extends object = object,
  M = never,
  N extends (keyof LocaleNamespaceMap & string) | LocaleDefinition | undefined = undefined,
  C extends SlotComponent<never> = SlotComponent<never>,
> = {
  readonly component: C &
    SlotComponent<
      ComposedProps<K, EntryKey, keyof D & keyof SlotMap & string, HandleOf<H>, I, M, N extends keyof LocaleNamespaceMap & string ? N : undefined> &
        (N extends LocaleDefinition ? PropsLocaleOf<N> : object)
    > &
    RendersCheck<C, D>
  readonly children?: D
  readonly store?: H
  readonly inject?: (...args: InjectParams<K, H>) => I
  readonly locale?: N
  readonly registrant?: string
} & KindOptions<K, EntryKey, M> &
  SlotMetadataOptions<K>

/** Registration metadata a Slot's Host contract reads from its ledger entry; only `settings.section` declares one. */
export type SlotMetadataOptions<K extends string> = K extends 'settings.section' ? { readonly metadata?: SettingsSectionMetadata } : unknown

/** Opaque declarative Slot contribution consumed by the Client adapter. */
export interface SlotContribution<K extends keyof SlotMap & string = keyof SlotMap & string, O extends object = object, C = unknown> {
  readonly [slotContributionBrand]: {
    readonly name: K
    readonly options: O
    readonly component: C
  }
}
