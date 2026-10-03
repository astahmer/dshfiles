import { defineLocale } from '@dshfiles/dshx/client'

/** The queue dock renders inside the conversation surface, so it joins its locale. */
export const QUEUE_REORDER_LOCALE_NAMESPACE = 'conversation' as const

const en = {
  queueReorderHint: 'queued — drag to reorder, top runs first',
  queueReorderMoveUp: 'Move queued message up',
  queueReorderMoveDown: 'Move queued message down',
}

const zh = {
  queueReorderHint: '已排队 — 拖动可调整顺序，靠上的先执行',
  queueReorderMoveUp: '上移排队消息',
  queueReorderMoveDown: '下移排队消息',
}

export const queueReorderLocale = defineLocale(QUEUE_REORDER_LOCALE_NAMESPACE, { en, zh })
