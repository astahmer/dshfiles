import { invokeClientSetup } from '../sdk/setup.js'
import type { Context } from '@deepseek-ai/cordis'
import { DshxError } from '../diagnostics.js'
import type {
  ClientComponentDecorator,
  ClientConversationContribution,
  ClientContext,
  ClientDefinition,
  LocaleDefinition,
  LocaleDictionaries,
  SlotContribution,
} from './types.js'
import { isSlotContribution, slotContributionParts, type SlotRegistrationOptions } from './define.js'
import { isLocaleDefinition, localeDefinitionParts } from './locale.js'
import { getConversationContributionParts, isConversationContribution } from '../conversation/define.js'
import { ApiClientLifecycle } from '../api/client.js'
import { createSettingsClientRuntime, provideSettingsContext } from '../settings/client.js'
import { registerPluginPageSettings } from '../settings/plugin-page.js'
import { PROTOCOL_2_COMPATIBILITY } from '../compat/protocol-2.js'
import { CLIENT_DEFAULT_SERVICES } from 'create-dshx/runtime-capabilities'
import type { DshCompatibility } from '../compat/types.js'

const CLIENT_DEFINITION_KEYS = new Set(['name', 'inject', 'locales', 'conversations', 'slots', 'setup'])
const LOCALE_IDS = ['zh', 'en'] as const

/** Project identity embedded by the Client compiler. */
export interface ClientPluginMetadata {
  readonly packageId: string
  readonly logicalName?: string
  readonly sourceFile?: string
  readonly settingsCapability?: boolean
  readonly apiCapability?: boolean
  readonly compatibility?: DshCompatibility
  /** Loader row ids of this package, rendered as a form on its Plugins page while served. */
  readonly pluginPageNamespaces?: readonly string[]
}

/** Normalized Client module surface consumed by the virtual entry. */
export interface CreatedClientPlugin {
  readonly name: string
  readonly inject?: unknown
  readonly Config?: unknown
  apply(ctx: Context | ClientContext, config?: unknown): unknown
}

interface ClientSlotsService {
  inject(name: string, register: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): unknown
}

interface ClientConversationEventsService {
  register(definition: unknown): unknown
}

interface ClientLocaleService {
  register(namespace: string, dictionaries: LocaleDictionaries): () => void
}

type ClientRuntimeContext = ClientContext & {
  readonly conversationEvents: ClientConversationEventsService
  readonly locale: ClientLocaleService
  readonly slots: ClientSlotsService
}

function fail(
  code: 'DSHX2101' | 'DSHX2102' | 'DSHX2201' | 'DSHX2202' | 'DSHX2301' | 'DSHX2302' | 'DSHX2401' | 'DSHX2402',
  message: string,
  metadata: ClientPluginMetadata,
  hint: string,
): never {
  throw new DshxError(code, message, {
    ...(metadata.sourceFile === undefined ? {} : { file: metadata.sourceFile }),
    hint,
  })
}

function fallbackName(metadata: ClientPluginMetadata): string {
  return metadata.logicalName ?? metadata.packageId
}

function validateContribution(value: unknown, metadata: ClientPluginMetadata, index: number): SlotContribution {
  if (!isSlotContribution(value)) {
    fail(
      'DSHX2201',
      `Client slot contribution at index ${index} must be an object returned by defineSlot().`,
      metadata,
      'Use defineSlot("slot.name", { component: Component, ...registrationOptions }) inside defineClient({ slots: [...] }).',
    )
  }
  const parts = slotContributionParts(value)
  const slotName: unknown = parts.name
  if (typeof slotName !== 'string' || slotName.trim() === '') {
    fail(
      'DSHX2202',
      `Client slot contribution at index ${index} must have a non-empty name.`,
      metadata,
      'Use a declared SlotMap key as the first argument to defineSlot().',
    )
  }
  if (typeof parts.options !== 'object' || parts.options === null || Array.isArray(parts.options)) {
    fail(
      'DSHX2202',
      `Client slot contribution at index ${index} has invalid registration options.`,
      metadata,
      'Pass the official Slot registration fields as the second argument to defineSlot().',
    )
  }
  if (typeof parts.component !== 'function') {
    fail(
      'DSHX2202',
      `Client slot contribution at index ${index} must provide a component function.`,
      metadata,
      'Pass component: YourReactComponent to defineSlot().',
    )
  }
  const locale = (parts.options as Record<string, unknown>).locale
  if (locale !== undefined && !isLocaleDefinition(locale) && (typeof locale !== 'string' || locale.trim() === '' || locale !== locale.trim())) {
    fail(
      'DSHX2202',
      `Client slot contribution at index ${index} has an invalid locale option.`,
      metadata,
      'Pass a non-empty native Locale namespace string or a value returned by defineLocale().',
    )
  }
  return value as SlotContribution
}

function validateLocaleContribution(value: unknown, metadata: ClientPluginMetadata, index: number): LocaleDefinition {
  if (!isLocaleDefinition(value)) {
    fail(
      'DSHX2401',
      `Client Locale contribution at index ${index} must be an object returned by defineLocale().`,
      metadata,
      'Use defineLocale("namespace", { zh: { ... }, en: { ... } }) inside defineClient({ locales: [...] }).',
    )
  }
  const { namespace, dictionaries } = localeDefinitionParts(value)
  if (typeof namespace !== 'string' || namespace.trim() === '' || namespace !== namespace.trim()) {
    fail(
      'DSHX2402',
      `Client Locale contribution at index ${index} must have a non-empty namespace without surrounding whitespace.`,
      metadata,
      'Use a stable namespace such as "settings.myPlugin" as the first defineLocale() argument.',
    )
  }
  if (typeof dictionaries !== 'object' || dictionaries === null || Array.isArray(dictionaries)) {
    fail(
      'DSHX2402',
      `Client Locale contribution at index ${index} must provide complete zh/en dictionaries.`,
      metadata,
      'Pass { zh: { key: "..." }, en: { key: "..." } } as the second defineLocale() argument.',
    )
  }
  const localeIds = Object.keys(dictionaries)
  if (localeIds.length !== LOCALE_IDS.length || LOCALE_IDS.some(locale => !Object.hasOwn(dictionaries, locale))) {
    fail(
      'DSHX2402',
      `Client Locale contribution at index ${index} must provide exactly the zh and en dictionaries.`,
      metadata,
      'Add the missing shipped locale or remove unsupported locale ids.',
    )
  }
  let expectedKeys: readonly string[] | undefined
  for (const locale of LOCALE_IDS) {
    const dictionary = dictionaries[locale] as unknown
    if (typeof dictionary !== 'object' || dictionary === null || Array.isArray(dictionary)) {
      fail('DSHX2402', `Client Locale contribution at index ${index} has an invalid ${locale} dictionary.`, metadata, 'Use a flat key-to-string object.')
    }
    const entries = Object.entries(dictionary)
    if (entries.some(([key, text]) => key.trim() === '' || typeof text !== 'string')) {
      fail(
        'DSHX2402',
        `Client Locale contribution at index ${index} has an invalid ${locale} dictionary entry.`,
        metadata,
        'Use non-empty keys and string translation values.',
      )
    }
    const keys = entries.map(([key]) => key).sort()
    if (expectedKeys !== undefined && (keys.length !== expectedKeys.length || keys.some((key, keyIndex) => key !== expectedKeys?.[keyIndex]))) {
      fail(
        'DSHX2402',
        `Client Locale contribution at index ${index} must use identical keys in every dictionary.`,
        metadata,
        'Add or remove keys until the zh and en dictionaries have the same shape.',
      )
    }
    expectedKeys = keys
  }
  return value
}

function validateConversationContribution(value: unknown, metadata: ClientPluginMetadata, index: number): ClientConversationContribution {
  if (!isConversationContribution(value)) {
    fail(
      'DSHX2301',
      `Client Conversation contribution at index ${index} must be returned by defineConversation(...).render(Component).`,
      metadata,
      'Create the lifecycle with defineConversation({ kind, events, initial, reduce, project }) and add lifecycle.render(Component).',
    )
  }

  return value as ClientConversationContribution
}

function validateDefinition(value: unknown, metadata: ClientPluginMetadata): ClientDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(
      'DSHX2101',
      'The default Client export must be an object returned by defineClient().',
      metadata,
      'Default-export defineClient({ setup(ctx) { ... } }) or use native named Client exports without a default export.',
    )
  }
  const source = value as Record<string, unknown>
  const unknown = Object.keys(source).filter(key => !CLIENT_DEFINITION_KEYS.has(key))
  if (unknown.length > 0) {
    fail(
      'DSHX2102',
      `Client definition contains unknown field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
      metadata,
      'Remove unsupported fields and put direct Cordis behavior in setup(ctx), or use slots: [defineSlot("slot.name", { component })] for Slot contributions.',
    )
  }
  if (source.name !== undefined && (typeof source.name !== 'string' || source.name.trim() === '')) {
    fail('DSHX2102', 'Client definition name must be a non-empty string.', metadata, 'Remove name to use the resolved logical project name.')
  }
  if (source.inject !== undefined) {
    if (!Array.isArray(source.inject) || source.inject.some(item => typeof item !== 'string' || item.trim() === '')) {
      fail(
        'DSHX2102',
        'Client definition inject must be an array of non-empty service names.',
        metadata,
        'Use inject: ["serviceName"] or remove inject when no service is required.',
      )
    }
  }
  if (source.locales !== undefined) {
    if (!Array.isArray(source.locales)) {
      fail(
        'DSHX2402',
        'Client definition locales must be an array of defineLocale() contributions.',
        metadata,
        'Use locales: [defineLocale("namespace", { zh: { ... }, en: { ... } })] or remove locales.',
      )
    }
    const namespaces = new Set<string>()
    source.locales.forEach((locale, index) => {
      const contribution = validateLocaleContribution(locale, metadata, index)
      const namespace = localeDefinitionParts(contribution).namespace
      if (namespaces.has(namespace)) {
        fail(
          'DSHX2402',
          `Client definition contains duplicate Locale namespace ${JSON.stringify(namespace)}.`,
          metadata,
          'Register each Locale namespace exactly once in defineClient({ locales: [...] }).',
        )
      }
      namespaces.add(namespace)
    })
  }
  if (source.conversations !== undefined) {
    if (!Array.isArray(source.conversations)) {
      fail(
        'DSHX2302',
        'Client definition conversations must be an array of Conversation component contributions.',
        metadata,
        'Use conversations: [lifecycle.render(Component)] or remove conversations.',
      )
    }
    source.conversations.forEach((conversation, index) => validateConversationContribution(conversation, metadata, index))
  }
  if (source.slots !== undefined) {
    if (!Array.isArray(source.slots)) {
      fail(
        'DSHX2202',
        'Client definition slots must be an array of defineSlot() contributions.',
        metadata,
        'Use slots: [defineSlot("slot.name", { component })] or remove slots.',
      )
    }
    source.slots.forEach((slot, index) => validateContribution(slot, metadata, index))
  }
  if (source.setup !== undefined && typeof source.setup !== 'function') {
    fail('DSHX2102', 'Client definition setup must be a function.', metadata, 'Use setup(ctx) { ... } or remove setup.')
  }
  return value as ClientDefinition
}

type ComponentDecorator = ClientComponentDecorator

function normalizedSlotOptions(options: SlotRegistrationOptions): SlotRegistrationOptions {
  if (!isLocaleDefinition(options.locale)) return options
  return { ...options, locale: localeDefinitionParts(options.locale).namespace }
}

function registerLocales(client: ClientRuntimeContext, definition: ClientDefinition): void {
  for (const locale of definition.locales ?? []) {
    const { namespace, dictionaries } = localeDefinitionParts(locale)
    client.effect(() => client.locale.register(namespace, dictionaries))
  }
}

function registerContributions(client: ClientRuntimeContext, definition: ClientDefinition, decorate: ComponentDecorator): void {
  for (const conversation of definition.conversations ?? []) {
    const { definition: conversationDefinition, renderer } = getConversationContributionParts(conversation)
    client.conversationEvents.register(conversationDefinition)
    client.slots.inject(renderer.name, () => client.slots.register({ name: renderer.name, ...renderer.options }, decorate(renderer.component)))
  }
  for (const slot of definition.slots ?? []) {
    const { name, options, component } = slotContributionParts(slot)
    client.slots.inject(name, () => client.slots.register({ name, ...normalizedSlotOptions(options) }, decorate(component)))
  }
}

function registerPluginPage(ctx: unknown, metadata: ClientPluginMetadata): void {
  try {
    registerPluginPageSettings(ctx, { packageId: metadata.packageId, namespaces: metadata.pluginPageNamespaces ?? [] })
  } catch (error) {
    // The Plugins page form is a convenience; a Host that cannot host it must still run the plugin.
    console.warn(`DSHX Plugins page settings unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Convert a definition into the standard Cordis Client module contract. */
export function createClientPlugin(value: unknown, metadata: ClientPluginMetadata): CreatedClientPlugin {
  const definition = validateDefinition(value, metadata)
  const hasLocales = (definition.locales?.length ?? 0) > 0
  const hasConversations = (definition.conversations?.length ?? 0) > 0
  const compatibility = metadata.compatibility ?? PROTOCOL_2_COMPATIBILITY
  if (hasConversations && compatibility.client.conversation?.componentContributions !== true) {
    fail(
      'DSHX2302',
      'This DSH version has no native conversation event registry.',
      metadata,
      'Use ordinary typed UI slots instead. defineConversation renderers need a DSH generation that ships a conversation event registry.',
    )
  }
  const hasApiCapability = metadata.apiCapability === true
  // A free-form setup(ctx) may register Slots or Locales imperatively, so a definition
  // that brings its own setup and declares no inject of its own gets the whole runtime
  // surface. Definitions that do declare inject stay exactly as declared.
  const declaresInject = (definition.inject?.length ?? 0) > 0
  const usesFullRuntime = definition.setup !== undefined && !declaresInject
  const inject = [
    ...new Set([
      ...(definition.inject ?? []),
      ...(hasLocales || usesFullRuntime ? CLIENT_DEFAULT_SERVICES.filter(service => service === 'locale') : []),
      ...(hasConversations ? ['conversationEvents'] : []),
      ...((definition.slots?.length ?? 0) > 0 || usesFullRuntime || hasConversations ? CLIENT_DEFAULT_SERVICES.filter(service => service === 'slots') : []),
      ...(hasApiCapability ? ['connection'] : []),
    ]),
  ]
  const settingsService = compatibility.client.settings?.service
  if (metadata.settingsCapability === true && settingsService !== undefined && !inject.includes(settingsService)) inject.push(settingsService)
  return {
    name: definition.name ?? fallbackName(metadata),
    inject,
    apply(ctx) {
      const client = ctx as ClientRuntimeContext
      registerPluginPage(ctx, metadata)
      registerLocales(client, definition)
      const settings = metadata.settingsCapability === true ? createSettingsClientRuntime(ctx) : undefined
      if (!hasApiCapability) {
        const decorate = ((component: unknown): unknown =>
          settings === undefined ? component : provideSettingsContext(component as any, settings)) as ComponentDecorator
        registerContributions(client, definition, decorate)
        return invokeClientSetup(definition.setup, client, decorate, metadata)
      }
      const apiClient = ApiClientLifecycle.create(ctx, metadata.packageId)
      // The decorator returns a context-providing wrapper, which is a different
      // function type than the component it wraps. The contract callers rely on
      // is "renders the same component", so the wrapper is asserted once here
      // rather than leaking provider props into every registration site.
      const decorate = ((component: unknown): unknown => {
        const apiComponent = ApiClientLifecycle.provide(component as any, apiClient)
        return settings === undefined ? apiComponent : provideSettingsContext(apiComponent, settings)
      }) as ComponentDecorator
      registerContributions(client, definition, decorate)
      return invokeClientSetup(definition.setup, client, decorate, metadata)
    },
  }
}

/** Normalize either a defineClient default export or an existing native Client module. */
export function createClientModule(source: Record<string, unknown>, metadata: ClientPluginMetadata): CreatedClientPlugin {
  if (Object.hasOwn(source, 'default')) return createClientPlugin(source.default, metadata)
  if (typeof source.apply !== 'function') {
    fail(
      'DSHX2101',
      'A native Client module must export an apply function.',
      metadata,
      'Export default defineClient({ setup(ctx) { ... } }) or export function apply(ctx, config) { ... }.',
    )
  }
  if (source.name !== undefined && (typeof source.name !== 'string' || source.name.trim() === '')) {
    fail('DSHX2102', 'Native Client export name must be a non-empty string.', metadata, 'Remove name to use the resolved logical project name.')
  }
  const apply = source.apply as (ctx: Context | ClientContext, config?: unknown) => unknown
  return {
    name: (source.name as string | undefined) ?? fallbackName(metadata),
    ...(source.inject === undefined ? {} : { inject: source.inject }),
    ...(source.Config === undefined ? {} : { Config: source.Config }),
    apply(ctx, config) {
      registerPluginPage(ctx, metadata)
      return apply(ctx, config)
    },
  }
}
