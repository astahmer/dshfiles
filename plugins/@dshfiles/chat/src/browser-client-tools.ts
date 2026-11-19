import { defineClientTool, type BrowserService, type ClientToolItem } from '@dshfiles/dshx/client'
import * as Schema from 'effect/Schema'

/**
 * The browser pane as a client tool: open a URL beside the thread on screen, through the same `Browser` service the
 * dev-server Preview and Open buttons use. Unlike `preview_open` (a headless page on the Host), the page loads in the
 * user's own browser.
 * @param browser - the pane this plugin provides.
 * @returns the tools to add to `ClientTools`.
 */
const create = (browser: BrowserService): readonly ClientToolItem[] => [
  defineClientTool({
    name: 'browser_open',
    title: 'Open a page beside the thread',
    description:
      'Open an http(s) URL in the browser pane beside the thread on screen, in the user’s own browser (a local dev server, docs). Call only when the user asked to see that page.',
    readOnly: false,
    input: Schema.Struct({
      url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_048)).annotate({ description: 'http(s) address, e.g. "http://localhost:5173".' }),
    }),
    execute: input => {
      if (!URL.canParse(input.url) || !['http:', 'https:'].includes(new URL(input.url).protocol))
        throw new Error(`${input.url} is not an http(s) URL. Pass a full address such as http://localhost:5173.`)
      if (!browser.available.get())
        throw new Error('This window has no browser pane (the right sidebar Browser tab is off in this profile). Give the user the link instead.')
      if (!browser.open(input.url)) throw new Error('The browser pane refused the page: no thread is on screen. Ask the user to open a thread, then retry.')
      return { opened: input.url }
    },
  }),
]

export class BrowserClientTools {
  static readonly create = create
}
