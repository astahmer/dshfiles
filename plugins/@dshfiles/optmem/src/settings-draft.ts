import type { OptmemProvider } from './api.ts'
import { SummaryRouting } from './routing.ts'
import { optmemSettings, type OptmemSettings } from './settings.ts'

export type SettingsKey = keyof OptmemSettings & string

export type SettingsEdits = Partial<OptmemSettings>

/** A route problem found against the providers DSH reports; shown beside the field, never blocks saving. */
export type RouteWarning = { readonly field: string; readonly message: string }

const defaults: OptmemSettings = optmemSettings.schema({})

const settingsKeys = Object.keys(defaults).filter((key): key is SettingsKey => key in defaults)

const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

/** The settings panel's draft: Host value plus the fields the user edited, checked against the providers DSH reports. */
export class OptmemSettingsDraft {
  static readonly defaults = defaults

  /**
   * Decodes whatever the Host serves. An old Host lacks newer fields and a hand-edited entry may hold one bad field: each
   * field that does not decode falls back to its default instead of failing the whole panel.
   */
  static decode(raw: unknown): OptmemSettings {
    const source = typeof raw === 'object' && raw !== null ? raw : {}
    try {
      return optmemSettings.schema(source)
    } catch {
      const fields: Record<string, unknown> = {}
      for (const key of settingsKeys) {
        if (!(key in source)) continue
        const value: unknown = Reflect.get(source, key)
        try {
          optmemSettings.schema({ [key]: value })
          fields[key] = value
        } catch {
          // Dropped: this field keeps its default.
        }
      }
      return optmemSettings.schema(fields)
    }
  }

  static merge(base: OptmemSettings, edits: SettingsEdits): OptmemSettings {
    return { ...base, ...edits }
  }

  /** Edited fields whose value differs from the Host's, in schema order. */
  static changedKeys(base: OptmemSettings, edits: SettingsEdits): readonly SettingsKey[] {
    return settingsKeys.filter(key => key in edits && !sameValue(edits[key], base[key]))
  }

  /** The schema's own error for a draft, or undefined when the Host would accept it. */
  static validationError(draft: OptmemSettings): string | undefined {
    try {
      optmemSettings.schema(draft)
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  static move<T>(list: readonly T[], from: number, to: number): T[] {
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list]
    const next = [...list]
    const [item] = next.splice(from, 1)
    if (item !== undefined) next.splice(to, 0, item)
    return next
  }

  static routeWarnings(draft: OptmemSettings, providers: readonly OptmemProvider[]): readonly RouteWarning[] {
    if (providers.length === 0) return []
    const warnings: RouteWarning[] = []
    const byId = new Map(providers.map(provider => [provider.id, provider]))
    const checkRoute = (field: string, provider: string, model: string): void => {
      if (model.trim() === '') {
        warnings.push({ field, message: 'Choose a model.' })
        return
      }
      if (provider === '') {
        if (!providers.some(candidate => SummaryRouting.offeredModel(model, candidate.models) !== undefined))
          warnings.push({ field, message: `No configured provider offers ${model}; threads whose provider lacks it skip this route.` })
        return
      }
      const configured = byId.get(provider)
      if (!configured) warnings.push({ field, message: `Provider ${provider} is not configured in DSH.` })
      else if (configured.models.length > 0 && SummaryRouting.offeredModel(model, configured.models) === undefined)
        warnings.push({ field, message: `${provider} does not offer ${model}.` })
    }

    if (draft.summarizerModel !== '') checkRoute('override', draft.summarizerProvider, draft.summarizerModel)
    else if (draft.summarizerProvider !== '') warnings.push({ field: 'override', message: 'The override provider is ignored until a model is set.' })

    draft.cheapModels.forEach((entry, index) => {
      const field = `cheapModels.${index}`
      if (entry.kind.trim() === '') {
        warnings.push({ field, message: 'Name a provider kind or provider id.' })
        return
      }
      if (draft.cheapModels.findIndex(other => other.kind === entry.kind) !== index) {
        warnings.push({ field, message: `${entry.kind} is listed twice; only the first entry is used.` })
        return
      }
      const served = providers.filter(provider => SummaryRouting.cheapEntryFor(draft.cheapModels, provider.id, provider.kind ?? undefined) === entry)
      for (const provider of served) {
        if (provider.models.length === 0) continue
        if (entry.models.every(model => SummaryRouting.offeredModel(model, provider.models) === undefined))
          warnings.push({ field, message: `${provider.id} offers none of these models; its summaries go to the fallbacks.` })
      }
    })

    draft.summarizerFallbacks.forEach((entry, index) => checkRoute(`summarizerFallbacks.${index}`, entry.provider, entry.model))
    return warnings
  }
}
