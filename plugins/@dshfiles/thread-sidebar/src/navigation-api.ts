import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { DESTINATION_IDS } from './destination-ids.js'
import { SchemaHelpers } from './schema-helpers.js'

/**
 * A private navigation counter (plan `plans/ade-ux` §4.2): how often each rail destination and each of its sections
 * is opened, so later rail decisions rest on use rather than guesses. It records ids and counts only — never a thread,
 * a title or any other content — and stays on this Host.
 */
const panelIdSchema = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u))
const countSchema = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))
const timestampSchema = Schema.NullOr(countSchema)

export const NAVIGATION_SURFACES = ['rail', 'tab-bar', 'index', 'palette', 'moved-to', 'back'] as const
export const navigationSurfaceSchema = Schema.Literals(NAVIGATION_SURFACES)

export const navigationRecordSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    destination: Schema.Literals(DESTINATION_IDS),
    /** The opened section's page id; absent when only the destination's list was shown. */
    section: Schema.optional(panelIdSchema),
    surface: navigationSurfaceSchema,
  }),
)
export type NavigationRecord = typeof navigationRecordSchema.Type

const destinationCountSchema = Schema.Struct({
  destination: Schema.Literals(DESTINATION_IDS),
  opens: countSchema,
  lastOpenedAt: timestampSchema,
})
const sectionCountSchema = Schema.Struct({
  destination: Schema.Literals(DESTINATION_IDS),
  section: panelIdSchema,
  opens: countSchema,
  lastOpenedAt: timestampSchema,
})
const surfaceCountSchema = Schema.Struct({ surface: navigationSurfaceSchema, opens: countSchema })

export const navigationCountsSchema = Schema.Struct({
  /** When counting started, or when it was last reset. */
  since: timestampSchema,
  destinations: Schema.Array(destinationCountSchema),
  sections: Schema.Array(sectionCountSchema),
  surfaces: Schema.Array(surfaceCountSchema),
})
export type NavigationCounts = typeof navigationCountsSchema.Type

const render = (counts: NavigationCounts): string => {
  const destinations = counts.destinations
    .filter(entry => entry.opens > 0)
    .map(entry => `${entry.destination} ${String(entry.opens)}`)
    .join(', ')
  return destinations === '' ? 'No navigation recorded yet.' : `Destination opens: ${destinations}. ${String(counts.sections.length)} sections opened.`
}

export const threadSidebarNavigationApi = defineApi({
  id: 'thread-sidebar-navigation',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    record: method({
      input: navigationRecordSchema,
      output: Schema.Struct({ recorded: Schema.Boolean }),
      description: 'Count one rail destination or section open. Records ids and counts only, never content.',
    }),
    counts: method({
      input: SchemaHelpers.strictStruct(Schema.Struct({})),
      output: navigationCountsSchema,
      description:
        'Read how often each rail destination and section was opened in the DSH GUI, and from which surface (rail, phone tab bar, list index, palette, moved-to help, phone Back). Ids and counts only. Read-only.',
      tool: { name: 'shell_navigation_counts', readOnly: true, render },
    }),
    reset: method({
      input: SchemaHelpers.strictStruct(Schema.Struct({ confirm: Schema.Literal(true) })),
      output: navigationCountsSchema,
      description: 'Clear the navigation counts and start counting again. Call only when the user asked to reset them; confirm must be true.',
      tool: { name: 'shell_navigation_reset', render },
    }),
  },
})
