import type { DESTINATION_ORDER } from './overview-model.js'

/** The destination names the Getting started page and "Show me where" print; kept apart from the page, which loads lazily. */
const DESTINATION_LABELS = {
  threads: 'Threads',
  inbox: 'Inbox',
  land: 'Land',
  work: 'Work',
  agents: 'Agents',
  observe: 'Observe',
  knowledge: 'Knowledge',
  settings: 'Settings',
  'thread-panel': 'Thread panel',
  composer: 'Composer',
  transcript: 'Transcript',
  none: 'Agent tools',
} as const satisfies Record<(typeof DESTINATION_ORDER)[number], string>
const destinationLabels = new Map<string, string>(Object.entries(DESTINATION_LABELS))
export const destinationLabel = (id: string): string => destinationLabels.get(id) ?? id
