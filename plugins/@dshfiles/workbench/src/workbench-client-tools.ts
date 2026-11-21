import { defineClientTool, type ClientToolItem } from '@dshfiles/dshx/client'
import * as Schema from 'effect/Schema'
import type { WorkbenchPanelDefinition } from './registry.js'

/** The regions an Agent may name; nested surface paths stay the user's own layout. */
const REGIONS = ['main', 'right', 'bottom', 'left'] as const
export type ClientToolRegion = (typeof REGIONS)[number]

const matches = (panel: WorkbenchPanelDefinition, query: string): boolean => {
  const wanted = query.trim().toLocaleLowerCase()
  return wanted === '' || [panel.id, panel.title, panel.discoveryTitle ?? '', panel.threadFacet?.title() ?? ''].some(text => text.toLocaleLowerCase().includes(wanted))
}

/**
 * The workbench's client tools: list the panels plugins registered (Files, Artifacts, Jujutsu, Traces, thread facets…)
 * and open one, in the region the user keeps it or the one named. They go through the same registry and placement the
 * Add panel menu uses.
 * @param ports - the panel registry's listing and the workbench's open path.
 * @returns the tools to add to `ClientTools`.
 */
const create = (ports: {
  readonly panels: () => readonly WorkbenchPanelDefinition[]
  readonly open: (panelId: string, region: ClientToolRegion | undefined) => void
}): readonly ClientToolItem[] => [
  defineClientTool({
    name: 'workbench_panels',
    title: 'List panels',
    description:
      'The panels the user can open in the workbench (side and bottom panes, or the main view): id, title, and whether it is a thread panel (follows the thread on screen). query filters by id or title. Read-only.',
    readOnly: true,
    input: Schema.Struct({
      query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))).annotate({ description: 'Words to find in the panel id or title.' }),
    }),
    execute: input => ({
      panels: ports
        .panels()
        .filter(panel => panel.hiddenFromAdd !== true && matches(panel, input.query ?? ''))
        .map(panel => ({ id: panel.id, title: panel.discoveryTitle ?? panel.title, threadPanel: panel.threadFacet !== undefined })),
    }),
  }),
  defineClientTool({
    name: 'workbench_open_panel',
    title: 'Open a panel',
    description:
      'Open one workbench panel by id from workbench_panels: in the region the user last kept it, or in region (main, right, bottom, left). Call only when the user asked to see that panel.',
    readOnly: false,
    input: Schema.Struct({
      panelId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)).annotate({ description: 'Panel id from workbench_panels.' }),
      region: Schema.optionalKey(Schema.Literals(REGIONS)).annotate({ description: 'Where to open it; omit for its usual place.' }),
    }),
    execute: input => {
      const panel = ports.panels().find(candidate => candidate.id === input.panelId)
      if (panel === undefined || panel.hiddenFromAdd === true)
        throw new Error(`The workbench has no panel ${input.panelId}. Call workbench_panels for the ids it offers; a panel appears once its plugin is loaded.`)
      ports.open(panel.id, input.region)
      return { opened: panel.id, title: panel.discoveryTitle ?? panel.title, region: input.region ?? null }
    },
  }),
]

export class WorkbenchClientTools {
  static readonly create = create
}
