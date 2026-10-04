import { declareLocaleNamespace } from '@dshfiles/dshx/client'

/**
 * The Locale runtime rejects a second registrant for the same namespace and
 * locale, so the dock cannot extend the conversation namespace it renders
 * inside. It owns one instead.
 */
const dictionaries = {
  en: {
    queueReorderHint: 'queued — drag to reorder, top runs first',
    queueReorderMoveUp: 'Move queued message up',
    queueReorderMoveDown: 'Move queued message down',
  },
  zh: {
    queueReorderHint: '已排队 — 拖动可调整顺序，靠上的先执行',
    queueReorderMoveUp: '上移排队消息',
    queueReorderMoveDown: '下移排队消息',
  },
}

export const QUEUE_REORDER_LOCALE_NAMESPACE = 'conversation.queueReorder'

export const queueReorderLocale = declareLocaleNamespace(
  QUEUE_REORDER_LOCALE_NAMESPACE,
  dictionaries,
)