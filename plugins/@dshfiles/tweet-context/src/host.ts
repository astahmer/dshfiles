import { defineHost } from '@dshfiles/dshx/host'
import { createTweetContextTool } from './tweet-context.js'

export default defineHost({
  name: '@dshfiles/tweet-context',
  inject: ['tools', 'attachments'],
  tools: [ctx => createTweetContextTool(ctx.attachments)],
})
