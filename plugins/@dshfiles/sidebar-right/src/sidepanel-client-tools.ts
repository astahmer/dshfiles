import { defineClientTool, type ClientToolItem } from '@dshfiles/dshx/client'
import * as Schema from 'effect/Schema'

/** One page the side panel's guide offers: what picking it in the panel opens. */
export interface SidepanelPage {
  readonly kind: string
  readonly title: string
  readonly description: string | undefined
}

/**
 * The side panel as client tools: list the pages its guide offers (Changes, thread views, workspaces, terminal…) and
 * open one beside the thread on screen. Only guide pages are offered: those open without parameters, as a user's pick
 * does, so an Agent cannot open a page type that needs an address it does not have.
 * @param ports - the guide's pages, the thread on screen, and the panel's open-by-kind path.
 * @returns the tools to add to `ClientTools`.
 */
const create = (ports: {
  readonly pages: () => readonly SidepanelPage[]
  readonly onScreen: () => string | undefined
  readonly open: (kind: string) => void
}): readonly ClientToolItem[] => [
  defineClientTool({
    name: 'sidepanel_tabs',
    title: 'List side panel pages',
    description:
      'The pages the side panel beside the thread on screen can open (its guide: changes, thread views, workspaces, terminals…), each with its kind, title and what it shows. Read-only.',
    readOnly: true,
    input: Schema.Struct({}),
    execute: () => ({
      thread: ports.onScreen() ?? null,
      pages: ports
        .pages()
        .filter((page, index, all) => all.findIndex(other => other.kind === page.kind) === index)
        .map(page => ({
          kind: page.kind,
          title: page.title,
          ...(page.description !== undefined && { description: page.description }),
        })),
    }),
  }),
  defineClientTool({
    name: 'sidepanel_open',
    title: 'Open a side panel page',
    description:
      'Open one side panel page by kind from sidepanel_tabs beside the thread on screen, or reveal it when it is already open. Call only when the user asked to see that page.',
    readOnly: false,
    input: Schema.Struct({
      kind: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)).annotate({ description: 'Page kind from sidepanel_tabs.' }),
    }),
    execute: input => {
      const page = ports.pages().find(candidate => candidate.kind === input.kind)
      if (page === undefined)
        throw new Error(`The side panel offers no page ${input.kind}. Call sidepanel_tabs for the kinds it offers; a page appears once its plugin is loaded.`)
      if (ports.onScreen() === undefined) throw new Error('No thread is on screen, so there is no side panel. Ask the user to open a thread, or use tabs_open.')
      ports.open(page.kind)
      return { opened: page.kind, title: page.title }
    },
  }),
]

export class SidepanelClientTools {
  static readonly create = create
}
