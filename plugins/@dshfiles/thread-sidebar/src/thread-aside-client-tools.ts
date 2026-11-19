import { defineClientTool, type ClientToolItem } from '@dshfiles/dshx/client'
import * as Schema from 'effect/Schema'
import { ThreadReference } from './thread-reference.js'

/**
 * The thread aside as a client tool: show another thread in the side panel beside the thread on screen, through the
 * same open path the thread row's "Open in side panel" uses.
 * @param ports - the threads this window lists and their titles, whether a thread is on screen, and the aside opener.
 * @returns the tools to add to `ClientTools`.
 */
const create = (ports: {
  readonly listed: () => readonly string[]
  readonly title: (sessionId: string) => string | undefined
  readonly onScreen: () => string | undefined
  readonly openAside: (sessionId: string) => void
}): readonly ClientToolItem[] => [
  defineClientTool({
    name: 'thread_open_aside',
    title: 'Open a thread in the side panel',
    description:
      'Show another thread in the side panel beside the thread on screen, so the user reads both at once (tabs_open replaces the main view instead). sessionId is session-<uuid> or the t:<id> memory prints. The result carries link, a Markdown link to put in your reply. Call only when the user asked to see that thread beside this one.',
    readOnly: false,
    input: Schema.Struct({
      sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)).annotate({
        description: 'Thread id: session-<uuid>, or the t:<id> memory prints (at least 6 characters).',
      }),
    }),
    execute: input => {
      const resolution = ThreadReference.resolve({ reference: input.sessionId, listed: ports.listed() })
      if (resolution.kind !== 'found') throw new Error(ThreadReference.explain(resolution))
      const sessionId = resolution.sessionId
      const link = ThreadReference.link({ sessionId, title: ports.title(sessionId) ?? sessionId })
      const onScreen = ports.onScreen()
      if (onScreen === undefined)
        throw new Error(`No thread is on screen, so there is no side panel to open it in. Use tabs_open instead, or give the user ${link}.`)
      if (onScreen === sessionId) throw new Error(`${link} is already the thread on screen; open another one beside it.`)
      ports.openAside(sessionId)
      return { opened: sessionId, beside: onScreen, link }
    },
  }),
]

export class ThreadAsideClientTools {
  static readonly create = create
}
