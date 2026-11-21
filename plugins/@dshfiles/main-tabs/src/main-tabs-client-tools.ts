import { defineClientTool, type ClientToolItem } from '@dshfiles/dshx/client'
import * as Schema from 'effect/Schema'
import type { MainTabsService } from './tabs-contract.js'
import { ThreadReference } from '@dshfiles/thread-sidebar/thread-reference'

const id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))

const targetSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('thread'),
    sessionId: id.annotate({ description: 'Thread id: session-<uuid>, or the t:<id> memory prints (at least 6 characters).' }),
  }),
  Schema.Struct({
    kind: Schema.Literal('panel'),
    panelId: id.annotate({ description: 'Main panel id from tabs_list, e.g. "dshfiles-settings" for Settings.' }),
  }),
])

type Tab = ReturnType<MainTabsService['tabs']['get']>[number]

/** A tab's target as JSON: an absent panel scope is left out rather than sent as undefined. */
const targetOf = (target: Tab['target']) => {
  if (target.kind === 'thread') return { kind: target.kind, sessionId: target.sessionId }
  if (target.kind === 'start') return { kind: target.kind }
  return { kind: target.kind, panelId: target.panelId, ...(target.scope !== undefined && { scope: target.scope }) }
}

/** What an Agent reads of one tab: no presentation detail beyond what tells tabs apart. */
const viewOf = (tab: Tab) => ({
  id: tab.id,
  title: tab.title,
  active: tab.active,
  pinned: tab.pinned,
  target: targetOf(tab.target),
})

/**
 * The client tools the main tab strip offers Agents through the client bridge: list its tabs, open a thread or panel
 * in a tab, select a tab. Every tool works through the same `MainTabs` service other plugins use.
 * @param tabs - the strip's service.
 * @returns the tools to add to `ClientTools`.
 */
const create = (
  tabs: MainTabsService,
  threads: { readonly listed: () => readonly string[]; readonly title: (sessionId: string) => string | undefined },
): readonly ClientToolItem[] => [
  defineClientTool({
    name: 'tabs_list',
    title: 'List tabs',
    description:
      'The main tab strip of the user’s window in order: each tab’s id, title, whether it is active or pinned, and the thread or panel it shows. Empty while tabs are off. Read-only.',
    readOnly: true,
    input: Schema.Struct({}),
    execute: () => ({ tabs: tabs.tabs.get().map(viewOf) }),
  }),
  defineClientTool({
    name: 'tabs_open',
    title: 'Open a tab',
    description:
      'Open a thread or a main panel in the user’s tab strip, or select the tab that already shows it. newTab (default true) opens beside the current tab instead of replacing the preview tab. For a thread the result carries link, a Markdown link to put in your reply so the user can open it again. Call only when the user asked to open it.',
    readOnly: false,
    input: Schema.Struct({
      target: targetSchema,
      newTab: Schema.optionalKey(Schema.Boolean).annotate({ description: 'Open beside the current tab; defaults to true.' }),
      title: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))).annotate({ description: 'Tab title until the panel names itself.' }),
    }),
    execute: input => {
      const options = { newTab: input.newTab ?? true, ...(input.title !== undefined && { title: input.title }) }
      if (input.target.kind === 'panel') {
        const tabId = tabs.open(input.target, options)
        if (tabId === undefined) throw new Error('Tabs are off in this window (Settings › Main tabs); open the panel another way.')
        return { tabId }
      }
      const resolution = ThreadReference.resolve({ reference: input.target.sessionId, listed: threads.listed() })
      if (resolution.kind !== 'found') throw new Error(ThreadReference.explain(resolution))
      const sessionId = resolution.sessionId
      const link = ThreadReference.link({ sessionId, title: threads.title(sessionId) ?? input.title ?? sessionId })
      const tabId = tabs.open({ kind: 'thread', sessionId }, options)
      if (tabId === undefined)
        throw new Error(`Tabs are off in this window (Settings › Main tabs). Give the user ${link} instead; clicking it opens the thread.`)
      return { tabId, sessionId, link }
    },
  }),
  defineClientTool({
    name: 'tabs_focus',
    title: 'Select a tab',
    description: 'Select one tab of the user’s strip by id from tabs_list. Call only when the user asked to switch to it.',
    readOnly: false,
    input: Schema.Struct({ tabId: id.annotate({ description: 'Tab id from tabs_list.' }) }),
    execute: input => {
      if (!tabs.focus(input.tabId)) throw new Error(`No tab ${input.tabId} in this window's strip. Call tabs_list for the current ids.`)
      return { tabId: input.tabId }
    },
  }),
]

export class MainTabsClientTools {
  static readonly create = create
}
