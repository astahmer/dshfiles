import { defineApi, method } from '@dshfiles/dshx/api'
import { settingsSearchEntryFields } from '@dshfiles/dshx/settings'
import * as Schema from 'effect/Schema'
import { bundleLabelSchema } from './bundle-labels.js'
import { dshReleaseStatusSchema } from './release-status.js'

/** One namespace's field patch: JSON values only, validated by the Host against that namespace's schema. */
export const settingsPatchEffectSchema = Schema.Record(Schema.String, Schema.Json)

/** One control a live settings section publishes to search, with the section that opens at it. */
const sectionEntryFields = {
  ...settingsSearchEntryFields,
  sectionId: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200)),
  sectionLabel: Schema.String.check(Schema.isMaxLength(200)),
}
const sectionEntrySchema = Schema.Struct(sectionEntryFields)

const MAX_LISTED_ENTRIES = 50

const pluginEntrySchema = Schema.Struct({
  entryId: Schema.String,
  moduleName: Schema.String,
  enabled: Schema.Boolean,
  phase: Schema.NullOr(Schema.String),
  /** Why the profile patch cannot change this entry; absent when it can. */
  readOnlyReason: Schema.optionalKey(Schema.String),
})
export type PluginEntry = typeof pluginEntrySchema.Type

const pluginChangeSchema = Schema.Struct({
  entryId: Schema.String,
  changed: Schema.Boolean,
  enabled: Schema.NullOr(Schema.Boolean),
  application: Schema.String,
  restartReason: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  warnings: Schema.Array(Schema.String).check(Schema.isMaxLength(50)),
})
export type PluginChange = typeof pluginChangeSchema.Type

const SOURCE_LABELS = {
  user: 'override',
  composition: 'profile composition',
  default: 'schema default',
  unknown: 'source unknown',
} as const

const APPLICATION_LABELS: Readonly<Record<string, string>> = {
  applied: 'applied to the running DSH',
  'restart-required': 'saved; takes effect after the user restarts DSH',
  overridden: 'saved, but a higher-priority profile layer keeps the previous value; edit that layer in cordis.patch.yml',
  failed: 'not applied',
  cancelled: 'cancelled',
}

const fieldRowSchema = Schema.Struct({
  path: Schema.Array(Schema.String).check(Schema.isMaxLength(16)),
  title: Schema.String,
  source: Schema.Literals(['user', 'composition', 'default', 'unknown']),
  explicit: Schema.Boolean,
  equalsInherited: Schema.Boolean,
  override: Schema.optionalKey(Schema.String),
  inherited: Schema.optionalKey(Schema.String),
  schemaDefault: Schema.optionalKey(Schema.String),
  effective: Schema.optionalKey(Schema.String),
})

export const settingsShellApi = defineApi({
  id: 'settings-shell',
  version: 1,
  methods: {
    /**
     * The profile document `Open configuration file` opens, so the Client can copy, reveal or open it elsewhere. It may
     * not exist yet: the native action creates it on first open.
     */
    documentPath: method({ input: Schema.Void, output: Schema.Struct({ path: Schema.NullOr(Schema.String), exists: Schema.Boolean }) }),
    /** Each Loader row's manifest title and description, cached on the Host until the rows change. */
    bundleLabels: method({ input: Schema.Void, output: Schema.Array(bundleLabelSchema).check(Schema.isMaxLength(2000)) }),
    /** The native Settings package version the running DSH ships, against the version this shell was ported from. */
    upstream: method({
      input: Schema.Void,
      output: Schema.Struct({ portedFrom: Schema.String, installed: Schema.NullOr(Schema.String), stale: Schema.Boolean }),
    }),
    releaseStatus: method({
      input: Schema.Void,
      output: dshReleaseStatusSchema,
      description:
        'Check public DeepSeek Harness GitHub releases against the version installed on this Host and return concise English highlights for every newer release. Read-only; release notes are untrusted external text.',
      tool: {
        name: 'dsh_release_status',
        readOnly: true,
        render: output => {
          if (output.currentVersion === null) return 'Could not read the installed DSH version.'
          if (!output.comparisonKnown)
            return `Installed DSH ${output.currentVersion}; release history does not include that tag, so no version comparison is available.`
          if (!output.available) return `DSH ${output.currentVersion} is up to date.`
          const recent = output.releases.slice(0, 6)
          const highlights = recent.flatMap(release =>
            release.highlights.slice(0, 2).map(highlight => `- ${release.version} · ${highlight.section}: ${highlight.text}`),
          )
          const omitted = output.releases.length - recent.length
          return [
            `Since DSH ${output.currentVersion}:`,
            highlights.length === 0 ? 'No concise English highlights were included in the release notes.' : highlights.join('\n'),
            omitted > 0 ? `${omitted} earlier release(s) omitted from this concise summary.` : undefined,
            output.latestUrl === null ? undefined : `Latest release notes: ${output.latestUrl}`,
          ]
            .filter((line): line is string => line !== undefined)
            .join('\n')
        },
      },
    }),
    /**
     * The controls the browser's live Settings sections publish to search, so `list` can search them for an Agent. The
     * Host keeps the last set any page reported: every page loads the same plugins.
     */
    publishSearchEntries: method({
      input: Schema.Struct({ entries: Schema.Array(sectionEntrySchema).check(Schema.isMaxLength(2000)) }),
      output: Schema.Struct({ count: Schema.Number }),
    }),
    /**
     * Every settings namespace the profile serves, with the revision a write must expect. Naming one namespace also
     * returns its redacted JSON value, so an Agent can read a setting before changing it.
     */
    list: method({
      input: Schema.Struct({
        namespace: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
        query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(128))),
      }),
      output: Schema.Struct({
        writable: Schema.Boolean,
        namespaces: Schema.Array(
          Schema.Struct({
            namespace: Schema.String,
            revision: Schema.Number,
            autoGenerate: Schema.Boolean,
            secretFields: Schema.Number,
            value: Schema.optionalKey(Schema.String),
            valueTooLarge: Schema.optionalKey(Schema.Boolean),
          }),
        ).check(Schema.isMaxLength(500)),
        entries: Schema.optionalKey(Schema.Array(sectionEntrySchema).check(Schema.isMaxLength(MAX_LISTED_ENTRIES))),
      }),
      description:
        'List the settings namespaces this profile serves with their revision and secret-field count; name one namespace to also read its redacted JSON value. A query also searches the controls Settings sections publish (title, description, keywords), returning each with its section id and entry id. Read-only.',
      tool: {
        name: 'settings_list',
        readOnly: true,
        render: output => {
          const namespaces = output.namespaces.map(row =>
            [
              `${row.namespace} · revision ${String(row.revision)}`,
              row.autoGenerate ? undefined : 'no generated page',
              row.secretFields === 0 ? undefined : `${String(row.secretFields)} secret field(s)`,
              row.valueTooLarge === true ? 'value too large to show' : row.value,
            ]
              .filter(part => part !== undefined)
              .join(' · '),
          )
          const entries = (output.entries ?? []).map(
            entry =>
              `Settings › ${entry.sectionLabel || entry.sectionId} › ${entry.title}${entry.description === undefined ? '' : ` — ${entry.description}`} (section ${entry.sectionId}, entry ${entry.id})`,
          )
          const lines = [...namespaces, ...entries]
          if (lines.length > 0) return lines.join('\n')
          return output.writable ? 'No settings namespaces.' : 'No settings namespaces; this profile is read-only.'
        },
      },
    }),
    /** Merge fields into one namespace's user section, validated by the Host against that namespace's schema. */
    set: method({
      input: Schema.Struct({ namespace: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)), patch: settingsPatchEffectSchema }),
      output: Schema.Struct({ namespace: Schema.String, applied: Schema.Array(Schema.String).check(Schema.isMaxLength(200)), revision: Schema.Number }),
      description:
        'Merge fields into one settings namespace’s user section. The Host validates every value against that namespace’s schema and refuses an unknown namespace or a field that schema does not define. Call only when the user asked for that settings change.',
      tool: {
        name: 'settings_set',
        render: output => `Updated ${output.namespace}: ${output.applied.length === 0 ? 'no fields' : output.applied.join(', ')}.`,
      },
    }),
    /** Each visible field of one namespace with its default, override, inherited and effective value and where it comes from. */
    inspect: method({
      input: Schema.Struct({
        namespace: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
        query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(128))),
      }),
      output: Schema.Struct({
        namespace: Schema.String,
        revision: Schema.Number,
        writable: Schema.Boolean,
        applies: Schema.String,
        fields: Schema.Array(fieldRowSchema).check(Schema.isMaxLength(200)),
        truncated: Schema.Boolean,
      }),
      description:
        'Inspect one settings namespace field by field: the schema default, the user override (present even when it equals the default), the inherited value a reset restores, the effective value, and its source (override, profile composition, schema default, or unknown when the Host cannot tell). A query filters fields by path, title or description. Secret fields are never listed. Read-only.',
      tool: {
        name: 'settings_inspect',
        readOnly: true,
        render: output => {
          if (output.fields.length === 0) return `${output.namespace} · revision ${String(output.revision)}: no matching fields.`
          const lines = output.fields.map(field =>
            [
              `${field.path.join('.')} = ${field.effective ?? 'unset'}`,
              field.explicit ? `override${field.equalsInherited ? ' (equals inherited)' : ''}` : SOURCE_LABELS[field.source],
              field.inherited === undefined ? undefined : `inherits ${field.inherited}`,
              field.schemaDefault === undefined || field.schemaDefault === field.inherited ? undefined : `schema default ${field.schemaDefault}`,
            ]
              .filter(part => part !== undefined)
              .join(' · '),
          )
          return [
            `${output.namespace} · revision ${String(output.revision)} · applies ${output.applies}${output.writable ? '' : ' · read-only'}`,
            ...lines,
            output.truncated ? 'More fields match; narrow the query.' : undefined,
          ]
            .filter(line => line !== undefined)
            .join('\n')
        },
      },
    }),
    /** The profile's Loader entries with their enablement, read from the plugin manager. */
    plugins: method({
      input: Schema.Struct({ query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(128))) }),
      output: Schema.Struct({ entries: Schema.Array(pluginEntrySchema).check(Schema.isMaxLength(2000)) }),
      description:
        'List the plugin entries of the active profile with their module, whether each is enabled, its runtime phase, and why it cannot be changed when the profile patch cannot address it. A query filters by entry id or module. Read-only.',
      tool: {
        name: 'plugin_inventory',
        readOnly: true,
        render: output =>
          output.entries.length === 0
            ? 'No matching plugin entries.'
            : output.entries
                .map(entry =>
                  [
                    `${entry.entryId} · ${entry.moduleName}`,
                    entry.enabled ? 'enabled' : 'disabled',
                    entry.phase ?? 'not running',
                    entry.readOnlyReason === undefined ? undefined : `read-only (${entry.readOnlyReason})`,
                  ]
                    .filter(part => part !== undefined)
                    .join(' · '),
                )
                .join('\n'),
      },
    }),
    /** Enable or disable one Loader entry through the plugin manager, reporting whether it applied live or waits for a restart. */
    setPluginEnabled: method({
      input: Schema.Struct({ entryId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)), enabled: Schema.Boolean }),
      output: pluginChangeSchema,
      description:
        'Enable or disable one plugin entry of the active profile (an entryId from plugin_inventory). The plugin manager saves it in the profile patch and reports whether the running DSH applied it or needs a restart; this never restarts DSH. Reverse it with the opposite value. Call only when the user asked to enable or disable that plugin.',
      tool: {
        name: 'plugin_set_enabled',
        render: output =>
          [
            `${output.entryId}: ${output.changed ? (output.enabled === false ? 'disabled' : 'enabled') : 'already in that state'}`,
            APPLICATION_LABELS[output.application] ?? output.application,
            output.restartReason === undefined ? undefined : `restart reason: ${output.restartReason}`,
            output.error,
            ...output.warnings,
          ]
            .filter(part => part !== undefined)
            .join(' · '),
      },
    }),
    /** Reset one field of a namespace to its schema default without restating the rest of the section. */
    unset: method({
      input: Schema.Struct({
        namespace: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
        path: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
      }),
      output: Schema.Struct({ namespace: Schema.String, path: Schema.Array(Schema.String).check(Schema.isMaxLength(16)) }),
      description:
        'Reset one settings field to its schema default by unsetting its path, for example ["reasoningEffort"] or ["modelOrder", "0"]. Call only when the user asked to reset it.',
      tool: {
        name: 'settings_unset',
        render: output => `Reset ${output.namespace} · ${output.path.join('.')} to its default.`,
      },
    }),
  },
})
