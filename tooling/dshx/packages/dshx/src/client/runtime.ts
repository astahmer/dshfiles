import { SdkSetupRuntime } from '../sdk/setup.js'
import type { Context } from '@deepseek-ai/cordis'
import { DshxError } from '../diagnostics.js'
import { BrowserBroker } from './broker.js'
import { IsolationModel } from './isolation.js'
import type { PluginContext } from './plugin-context.js'
import { PluginRuntimeModel } from './plugin-runtime.js'
import type {
  ClientComponentDecorator,
  ClientConversationContribution,
  ClientContext,
  ClientDefinition,
  LocaleDefinition,
  LocaleDictionaries,
  SlotContribution,
} from './types.js'
import { ClientContributionModel, type SlotRegistrationOptions } from './define.js'
import { LocaleNamespaceModel } from './locale.js'
import { ConversationContributionModel } from '../conversation/define.js'
import { ApiClientLifecycle } from '../api/client.js'
import { BrowserTraceTransportModel } from '../tracing/browser-transport.js'
import { createSettingsClientRuntime, provideSettingsContext } from '../settings/client.js'
import { registerPluginPageSettings } from '../settings/plugin-page.js'
import { SettingsSearchEntriesModel } from '../settings/section-entries.js'
import { PROTOCOL_2_COMPATIBILITY } from '../compat/protocol-2.js'
import { CLIENT_DEFAULT_SERVICES } from 'create-dshx/runtime-capabilities'
import type { DshCompatibility } from '../compat/types.js'

const CLIENT_DEFINITION_KEYS = new Set(['name', 'inject', 'locales', 'conversations', 'slots', 'setup'])
const LOCALE_ID_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u
const SETTINGS_SECTION_SLOT = 'settings.section'

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
  /** Shared-position factories (`conversation.images.content`): replace one definition, fill every position it feeds. */
  registerFactory(options: Record<string, unknown>, component: unknown): unknown
}

interface ClientConversationEventsService {
  register(definition: unknown): unknown
}

interface ClientLocaleService {
  register(namespace: string, dictionaries: LocaleDictionaries): () => void
  register(namespace: string, locale: string, dictionary: Readonly<Record<string, string>>): () => void
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
    ...(metadata.sourceFile !== undefined && { file: metadata.sourceFile }),
    hint,
  })
}

function fallbackName(metadata: ClientPluginMetadata): string {
  return metadata.logicalName ?? metadata.packageId
}

function validateContribution(value: unknown, metadata: ClientPluginMetadata, index: number): SlotContribution {
  if (!ClientContributionModel.isContribution(value)) {
    fail(
      'DSHX2201',
      `Client slot contribution at index ${index} must be an object returned by defineSlot().`,
      metadata,
      'Use defineSlot("slot.name", { component: Component, ...registrationOptions }) inside defineClient({ slots: [...] }).',
    )
  }
  const parts = ClientContributionModel.parts(value)
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
  if (locale !== undefined && !LocaleNamespaceModel.isDefinition(locale) && (typeof locale !== 'string' || locale.trim() === '' || locale !== locale.trim())) {
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
  if (!LocaleNamespaceModel.isDefinition(value)) {
    fail(
      'DSHX2401',
      `Client Locale contribution at index ${index} must be an object returned by defineLocale().`,
      metadata,
      'Use defineLocale("namespace", { en: { ... }, zh: { ... } }) inside defineClient({ locales: [...] }).',
    )
  }
  const { namespace, dictionaries } = LocaleNamespaceModel.parts(value)
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
      `Client Locale contribution at index ${index} must provide locale dictionaries.`,
      metadata,
      'Pass { en: { key: "..." }, zh: { key: "..." } } as the second defineLocale() argument.',
    )
  }
  const english: unknown = dictionaries.en
  if (typeof english !== 'object' || english === null || Array.isArray(english)) {
    fail(
      'DSHX2402',
      `Client Locale contribution at index ${index} must provide an en dictionary.`,
      metadata,
      'Add the complete English dictionary; other locales fall back to it for missing keys.',
    )
  }
  const invalidLocaleId = Object.keys(dictionaries).find(locale => !LOCALE_ID_PATTERN.test(locale))
  if (invalidLocaleId !== undefined) {
    fail(
      'DSHX2402',
      `Client Locale contribution at index ${index} has an invalid locale id ${JSON.stringify(invalidLocaleId)}.`,
      metadata,
      'Use BCP 47-style locale ids such as "en", "zh" or "pt-BR".',
    )
  }
  const englishKeys = new Set(Object.keys(english))
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
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
    const extraKey = entries.find(([key]) => !englishKeys.has(key))?.[0]
    if (extraKey !== undefined) {
      fail(
        'DSHX2402',
        `Client Locale contribution at index ${index} has key ${JSON.stringify(extraKey)} in ${locale} that the en dictionary lacks.`,
        metadata,
        'English defines the key set: add the key to en or remove it from the other locale.',
      )
    }
  }
  return value
}

function validateConversationContribution(value: unknown, metadata: ClientPluginMetadata, index: number): ClientConversationContribution {
  if (!ConversationContributionModel.isContribution(value)) {
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
      const namespace = LocaleNamespaceModel.parts(contribution).namespace
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
  const { metadata: _metadata, ...registration } = options
  if (!LocaleNamespaceModel.isDefinition(registration.locale)) return registration
  return { ...registration, locale: LocaleNamespaceModel.parts(registration.locale).namespace }
}

/** The ledger drops registration metadata, so a section's search entries live as long as its registration in the shared seat. */
function registerSlot(client: ClientRuntimeContext, name: string, options: SlotRegistrationOptions, component: unknown): unknown {
  const dispose = client.slots.register({ name, ...normalizedSlotOptions(options) }, component)
  const sectionId = options.id
  if (name !== SETTINGS_SECTION_SLOT || typeof sectionId !== 'string') return dispose
  const entries = options.metadata?.searchEntries
  if (entries === undefined) return dispose
  const unpublish = SettingsSearchEntriesModel.publish({ sectionId, entries })
  return () => {
    unpublish()
    if (typeof dispose === 'function') dispose()
  }
}

function registerLocales(client: ClientRuntimeContext, definition: ClientDefinition): void {
  for (const locale of definition.locales ?? []) {
    const { namespace, dictionaries } = LocaleNamespaceModel.parts(locale)
    const registration = LocaleNamespaceModel.registration(dictionaries)
    client.effect(() => client.locale.register(namespace, registration.builtIn))
    for (const { locale: localeId, dictionary } of registration.additional) {
      client.effect(() => client.locale.register(namespace, localeId, dictionary))
    }
  }
}

const slotContributionId = (name: string, options: Record<string, unknown>): string => {
  const key = typeof options.id === 'string' ? options.id : typeof options.key === 'string' ? options.key : undefined
  return key === undefined ? name : `${name}:${key}`
}

const isolated = (component: unknown, owner: string, id: string): unknown =>
  typeof component === 'function' ? IsolationModel.isolate(component as (props: Readonly<Record<string, unknown>>) => null, { owner, id }) : component

function registerContributions(client: ClientRuntimeContext, definition: ClientDefinition, decorate: ComponentDecorator, owner: string): void {
  for (const conversation of definition.conversations ?? []) {
    const { definition: conversationDefinition, renderer } = ConversationContributionModel.parts(conversation)
    client.conversationEvents.register(conversationDefinition)
    client.slots.inject(renderer.name, () => client.slots.register({ name: renderer.name, ...renderer.options }, decorate(renderer.component)))
  }
  for (const slot of definition.slots ?? []) {
    const { name, options, component } = ClientContributionModel.parts(slot)
    const id = slotContributionId(name, options as Record<string, unknown>)
    client.slots.inject(name, () => registerSlot(client, name, options, decorate(isolated(component, owner, id))))
  }
}

const invokeSetup = (
  definition: ClientDefinition,
  client: ClientRuntimeContext,
  decorate: ComponentDecorator,
  metadata: ClientPluginMetadata,
  plugin: PluginContext,
): ReturnType<typeof SdkSetupRuntime.invokeClient> => {
  try {
    return SdkSetupRuntime.invokeClient(definition.setup, client, decorate, { ...metadata, plugin })
  } catch (error) {
    BrowserBroker.reportFailure({ owner: metadata.packageId, kind: 'setup', id: 'setup', error })
    throw error
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
        const baseDecorate = ((component: unknown): unknown =>
          settings === undefined ? component : provideSettingsContext(component as any, settings)) as ComponentDecorator
        const runtime = PluginRuntimeModel.create({ ctx: client, packageId: metadata.packageId, decorate: baseDecorate })
        registerContributions(client, definition, runtime.decorate, metadata.packageId)
        return invokeSetup(definition, client, runtime.decorate, metadata, runtime.plugin)
      }
      const apiClient = ApiClientLifecycle.create(ctx, metadata.packageId)
      if (typeof client.effect === 'function') client.effect(() => BrowserTraceTransportModel.connect(client))
      // The decorator returns a context-providing wrapper, which is a different
      // function type than the component it wraps. The contract callers rely on
      // is "renders the same component", so the wrapper is asserted once here
      // rather than leaking provider props into every registration site.
      const baseDecorate = ((component: unknown): unknown => {
        const apiComponent = ApiClientLifecycle.provide(component as any, apiClient)
        return settings === undefined ? apiComponent : provideSettingsContext(apiComponent, settings)
      }) as ComponentDecorator
      const runtime = PluginRuntimeModel.create({ ctx: client, packageId: metadata.packageId, decorate: baseDecorate })
      registerContributions(client, definition, runtime.decorate, metadata.packageId)
      return invokeSetup(definition, client, runtime.decorate, metadata, runtime.plugin)
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
    ...(source.inject !== undefined && { inject: source.inject }),
    ...(source.Config !== undefined && { Config: source.Config }),
    apply(ctx, config) {
      registerPluginPage(ctx, metadata)
      return apply(ctx, config)
    },
  }
}
