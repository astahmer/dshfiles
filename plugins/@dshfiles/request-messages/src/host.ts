import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'
import { defineHost } from '@dshfiles/dshx/host'
import type {} from './contract.ts'
import { installRequestMessages } from './polyfill.ts'

export default defineHost({
  name: '@dshfiles/request-messages',
  inject: ['llm', 'agents'],
  setup: ctx => {
    const status = installRequestMessages(ctx)
    if (!status.active) ctx.logger('request-messages').warn('agent/request-messages is unavailable: %s', status.reason)
    ctx.on('request-messages/status', () => status)
  },
})
