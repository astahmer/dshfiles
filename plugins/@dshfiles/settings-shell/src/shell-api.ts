import { defineApi, method } from '@dshfiles/dshx/api'
import { settingsSearchEntryFields } from '@dshfiles/dshx/settings'
import * as Schema from 'effect/Schema'
import { z } from 'zod'
import { dshReleaseStatusSchema } from './release-status.js'

/** One namespace's field patch: JSON values only, validated by the Host against that namespace's schema. */
export const settingsPatchSchema = z.record(z.string(), z.json())

// The remaining contracts keep Zod's strict-object and JSON-schema behavior; search entries compose the SDK's Effect schema.

/** One control a live settings section publishes to search, with the section that opens at it. */
const sectionEntryFields = {
  ...settingsSearchEntryFields,
  sectionId: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200)),
  sectionLabel: Schema.String.check(Schema.isMaxLength(200)),
}
const sectionEntrySchema = Schema.Struct(sectionEntryFields)

const MAX_LISTED_ENTRIES = 50

export const settingsShellApi = defineApi({
  id: 'settings-shell',
  version: 1,
  methods: {
    /**
     * The profile document `Open configuration file` opens, so the Client can copy, reveal or open it elsewhere. It may
     * not exist yet: the native action creates it on first open.
     */
    documentPath: method({ input: z.void(), output: z.object({ path: z.string().nullable(), exists: z.boolean() }) }),
    /** The native Settings package version the running DSH ships, against the version this shell was ported from. */
    upstream: method({
      input: z.void(),
      output: z.object({ portedFrom: z.string(), installed: z.string().nullable(), stale: z.boolean() }),
    }),
    releaseStatus: method({
      input: z.void(),
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
      input: Schema.toStandardSchemaV1(Schema.Struct({ entries: Schema.Array(sectionEntrySchema).check(Schema.isMaxLength(2000)) })),
      output: Schema.toStandardSchemaV1(Schema.Struct({ count: Schema.Number })),
    }),
    /**
     * Every settings namespace the profile serves, with the revision a write must expect. Naming one namespace also
     * returns its redacted JSON value, so an Agent can read a setting before changing it.
     */
    list: method({
      input: z.object({ namespace: z.string().min(1).max(128).optional(), query: z.string().max(128).optional() }).strict(),
      output: Schema.toStandardSchemaV1(
        Schema.Struct({
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
      ),
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
      input: z.object({ namespace: z.string().min(1).max(128), patch: settingsPatchSchema }).strict(),
      output: z.object({ namespace: z.string(), applied: z.array(z.string()).max(200), revision: z.number() }).strict(),
      description:
        'Merge fields into one settings namespace’s user section. The Host validates every value against that namespace’s schema and refuses an unknown namespace or a field that schema does not define. Call only when the user asked for that settings change.',
      tool: {
        name: 'settings_set',
        render: output => `Updated ${output.namespace}: ${output.applied.length === 0 ? 'no fields' : output.applied.join(', ')}.`,
      },
    }),
    /** Reset one field of a namespace to its schema default without restating the rest of the section. */
    unset: method({
      input: z.object({ namespace: z.string().min(1).max(128), path: z.array(z.string().min(1).max(128)).min(1).max(16) }).strict(),
      output: z.object({ namespace: z.string(), path: z.array(z.string()).max(16) }).strict(),
      description:
        'Reset one settings field to its schema default by unsetting its path, for example ["reasoningEffort"] or ["modelOrder", "0"]. Call only when the user asked to reset it.',
      tool: {
        name: 'settings_unset',
        render: output => `Reset ${output.namespace} · ${output.path.join('.')} to its default.`,
      },
    }),
  },
})
