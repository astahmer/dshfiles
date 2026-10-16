import { PluginApiError } from '@dshfiles/dshx/api'
import { z } from 'zod'
import type { settingsPatchSchema } from './shell-api.js'

/** One namespace's field patch, derived from the contract's input schema. */
export type SettingsPatch = z.infer<typeof settingsPatchSchema>

/** What these tools read from one settings namespace; `SettingsDescriptor` satisfies it. */
export interface SettingsRow {
  readonly ns: string
  readonly revision: number
  readonly autoGenerate: boolean
  readonly secrets?: readonly unknown[]
  readonly value: unknown
}

/** A field reset. Path mutation exists so a caller holding a redacted view never restates the section. */
export interface SettingsUnsetOp {
  readonly op: 'unset'
  readonly path: readonly string[]
}

/** The Host settings surface these tools call; `SettingsForms` satisfies it. */
export interface SettingsSurface {
  readonly writable: boolean
  describe(options?: { readonly redactSecrets?: boolean }): readonly SettingsRow[]
  update(ns: string, patch: SettingsPatch, expectedRevision?: number): Promise<void>
  mutate(ns: string, ops: readonly SettingsUnsetOp[], expectedRevision?: number): Promise<void>
}

export interface SettingsListInput {
  readonly namespace?: string | undefined
  readonly query?: string | undefined
}
export interface SettingsSetInput {
  readonly namespace: string
  readonly patch: SettingsPatch
}
export interface SettingsUnsetInput {
  readonly namespace: string
  readonly path: readonly string[]
}

export interface SettingsNamespaceRow {
  readonly namespace: string
  readonly revision: number
  readonly autoGenerate: boolean
  readonly secretFields: number
  readonly value?: string
  readonly valueTooLarge?: boolean
}

/** One namespace section is far larger than any settings form; keep the model-facing JSON bounded. */
const MAX_VALUE_BYTES = 64 * 1024
const MAX_NAMES_IN_ERROR = 8
const MAX_MESSAGE = 300

const failureSchema = z.looseObject({ code: z.string().optional(), message: z.string().optional() })

const failureCode = (error: unknown): string | undefined => {
  const parsed = failureSchema.safeParse(error)
  return parsed.success ? parsed.data.code : undefined
}

const failureMessage = (error: unknown, fallback: string): string => {
  const parsed = failureSchema.safeParse(error)
  const message = parsed.success ? parsed.data.message : undefined
  return (message ?? fallback).slice(0, MAX_MESSAGE)
}

const jsonBytes = (text: string): number => new TextEncoder().encode(text).length

/** Builds the settings tools over the Host settings service, resolved per call. */
export const createSettingsTools = (settings: () => SettingsSurface) => {
  const requireNamespace = (surface: SettingsSurface, namespace: string): SettingsRow => {
    const found = surface.describe({ redactSecrets: true }).find(descriptor => descriptor.ns === namespace)
    if (found !== undefined) return found
    const known = surface
      .describe({ redactSecrets: true })
      .slice(0, MAX_NAMES_IN_ERROR)
      .map(descriptor => descriptor.ns)
    throw new PluginApiError(
      known.length === 0
        ? `No settings namespace named ${namespace}; this profile serves none.`
        : `No settings namespace named ${namespace}. Known namespaces include ${known.join(', ')}.`,
      { code: 'settings-namespace-unknown' },
    )
  }

  const requireWritable = (surface: SettingsSurface): void => {
    if (!surface.writable) {
      throw new PluginApiError('The active profile does not accept settings edits.', { code: 'settings-read-only' })
    }
  }

  const writeFailure = (error: unknown, namespace: string): PluginApiError => {
    if (failureCode(error) === 'SETTINGS_CONFLICT') {
      return new PluginApiError(`${namespace} changed since it was read; read it again with settings_list and retry.`, {
        code: 'settings-conflict',
      })
    }
    return new PluginApiError(failureMessage(error, `Could not write settings namespace ${namespace}.`), {
      code: 'settings-rejected',
    })
  }

  return {
    list: ({ input }: { readonly input: SettingsListInput }) => {
      const surface = settings()
      const query = input.query?.trim().toLowerCase()
      const descriptors = surface.describe({ redactSecrets: true })
      const namespaces = descriptors
        .filter(descriptor =>
          input.namespace === undefined
            ? query === undefined || query.length === 0 || descriptor.ns.toLowerCase().includes(query)
            : descriptor.ns === input.namespace,
        )
        .map((descriptor): SettingsNamespaceRow => {
          const row: SettingsNamespaceRow = {
            namespace: descriptor.ns,
            revision: descriptor.revision,
            autoGenerate: descriptor.autoGenerate,
            secretFields: descriptor.secrets?.length ?? 0,
          }
          if (input.namespace === undefined) return row
          const text = JSON.stringify(descriptor.value)
          if (text === undefined) return row
          if (jsonBytes(text) > MAX_VALUE_BYTES) return { ...row, valueTooLarge: true }
          return { ...row, value: text }
        })
      if (input.namespace !== undefined && namespaces.length === 0) requireNamespace(surface, input.namespace)
      return { writable: surface.writable, namespaces }
    },

    set: async ({ input }: { readonly input: SettingsSetInput }) => {
      const surface = settings()
      requireWritable(surface)
      const descriptor = requireNamespace(surface, input.namespace)
      try {
        await surface.update(input.namespace, input.patch, descriptor.revision)
      } catch (error) {
        throw writeFailure(error, input.namespace)
      }
      return {
        namespace: input.namespace,
        applied: Object.keys(input.patch).sort(),
        revision: descriptor.revision,
      }
    },

    unset: async ({ input }: { readonly input: SettingsUnsetInput }) => {
      const surface = settings()
      requireWritable(surface)
      const descriptor = requireNamespace(surface, input.namespace)
      try {
        await surface.mutate(input.namespace, [{ op: 'unset', path: input.path }], descriptor.revision)
      } catch (error) {
        throw writeFailure(error, input.namespace)
      }
      return { namespace: input.namespace, path: [...input.path] }
    },
  }
}
