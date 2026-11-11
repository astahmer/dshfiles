/**
 * How much of a subscribed thread reaches its subscriber: `all` every turn end, `outcomes` only when it landed, failed or
 * asks a question, `stuck` only when it failed, asks a question or made no progress (blocked, truncated), `never` none
 * while the subscription stays.
 */
export const SUBSCRIPTION_NOTICE_LEVELS = ['all', 'outcomes', 'stuck', 'never'] as const

export type SubscriptionNoticeLevel = (typeof SUBSCRIPTION_NOTICE_LEVELS)[number]

/**
 * How a notice reaches a subscriber that is running: `steer` joins its live turn at the next step, `queue` waits for
 * that turn to end and starts the next one. An idle subscriber is woken either way.
 */
export const SUBSCRIPTION_DELIVERY_MODES = ['steer', 'queue'] as const

export type SubscriptionDeliveryMode = (typeof SUBSCRIPTION_DELIVERY_MODES)[number]
