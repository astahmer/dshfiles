import { defineHost, definePromptSection } from '@dshfiles/dshx/host'
import { mainTabsSettings } from './settings.js'

/**
 * How an Agent cites another thread so the user can open it again: the client turns `thread:` links into tab opens.
 * Without it an Agent wrote the raw id, or opened a tab the user then had to ask for again.
 */
const threadLinkSection = definePromptSection({
  name: 'dshfiles-main-tabs:thread-links',
  order: 905,
  text: [
    'To point the user at another DSH conversation, write a Markdown link `[title](thread:session-<uuid>)`; clicking it',
    'opens that thread in a tab. A short id such as `thread:122d56e6` (6+ characters, as memory prints `t:122d56e6`) also',
    'works when it names one thread; Shift-click opens it in the side panel. tabs_open and thread_open_aside return such a link.',
  ].join(' '),
})

export default defineHost({
  name: '@dshfiles/main-tabs',
  settings: [mainTabsSettings],
  prompts: [threadLinkSection],
})
