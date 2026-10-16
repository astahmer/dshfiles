import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { defineClient } from '@dshfiles/dshx/client'
import { TOOL_META_LOCALE_NAMESPACE, toolMetaLocale } from './locales.js'
import { installToolCallTreeWrapper, isToolCallTreeWrapped } from './tool-call-tree.js'
import { ToolMetaLine } from './tool-meta-line.js'
import { warnOnce } from './warn-once.js'

/** The chat and the tool renderer load beside this plugin; past this they are not coming. */
const WRAP_DEADLINE_MS = 15_000

export default defineClient({
  name: '@dshfiles/tool-meta',
  locales: [toolMetaLocale],
  inject: ['slots'],
  setup(ctx, decorate) {
    const t = ctx.locale.bind(TOOL_META_LOCALE_NAMESPACE)
    const TimedLine = decorate(ToolMetaLine)
    const Meta = ({ owner }: { readonly owner: ToolCallOwnerProps }) => <TimedLine owner={owner} t={t} />
    ctx.effect(() => installToolCallTreeWrapper({ slots: ctx.slots, Meta }), 'tool-meta: wrap the tool-call renderer')
    ctx.effect(() => {
      const timer = setTimeout(() => {
        if (!isToolCallTreeWrapped(ctx.slots)) warnOnce('no conversation.chat.node "tool-call" renderer to wrap; tool timings are hidden')
      }, WRAP_DEADLINE_MS)
      return () => clearTimeout(timer)
    }, 'tool-meta: report a missing tool-call renderer')
  },
})
