import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'

/** Pricing projection and identity offered to the completed-turn usage dialog. */
export interface TurnUsageCostOwnerProps {
  readonly turn: number
  readonly useProjection: UseProjection
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** AI Accounts decodes the optional cost projection at its Client boundary. */
    aiAccountsCost: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Optional estimated cost row inside a completed Turn's usage dialog. */
    'conversation.chat.turnUsageCost': { kind: 'list'; scope: 'session'; owner: TurnUsageCostOwnerProps }
  }
}
