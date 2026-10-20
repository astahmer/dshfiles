import { defineHost } from '@dshfiles/dshx/host'
import { tweetContextTool } from './tweet-context.js'

export default defineHost({
  name: '@dshfiles/tweet-context',
  inject: ['tools', 'attachments'],
  tools: [tweetContextTool],
})
