import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_UNREAD_LANDING, UNREAD_LANDING_FIELD,
  type ChatSettings, type UnreadLanding,
} from '../chat-settings.ts'

/** Accepted unread-landing preference, written through to the Host settings document. */
export class UnreadLandingPolicy {
  private readonly unsubscribe: () => void
  readonly landing = createSnapshotStore<UnreadLanding>(DEFAULT_UNREAD_LANDING)

  constructor(private readonly host: ConfigForm<ChatSettings>) {
    const adopt = (): void => {
      const accepted = host.getSnapshot().value?.unreadLanding
      if (accepted !== undefined) this.landing.set(accepted)
    }
    this.unsubscribe = host.subscribe(adopt)
    adopt()
  }

  dispose(): void { this.unsubscribe() }

  setLanding(landing: UnreadLanding): void {
    if (landing === this.landing.getSnapshot()) return
    this.landing.set(landing)
    void this.host.set(UNREAD_LANDING_FIELD, landing).catch(() => {})
  }
}

const SEEN_ANSWERS_KEY = 'dshfiles-chat:seen-answers'
/** Enough for every thread a person returns to; the oldest entries drop first. */
const SEEN_ANSWERS_LIMIT = 500
const SeenAnswersSchema = z.array(z.tuple([z.string(), z.string()]))

interface AnswerStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/**
 * Per-browser memory of the final answer the reader last reached in each Session, by its anchor key.
 * A Session whose latest answer differs is unread. Storage failures degrade to memory only.
 */
export class SeenAnswers {
  private readonly entries: Map<string, string>

  constructor(private readonly storage: AnswerStorage | null, private readonly limit = SEEN_ANSWERS_LIMIT) {
    this.entries = new Map(SeenAnswers.decode(storage))
  }

  private static decode(storage: AnswerStorage | null): ReadonlyArray<readonly [string, string]> {
    try {
      return SeenAnswersSchema(JSON.parse(storage?.getItem(SEEN_ANSWERS_KEY) ?? '[]'))
        .flatMap(([sessionId, anchorKey]) => sessionId === undefined || anchorKey === undefined ? [] : [[sessionId, anchorKey] as const])
    } catch {
      return []
    }
  }

  read(sessionId: string): string | null {
    return this.entries.get(sessionId) ?? null
  }

  markSeen(sessionId: string, anchorKey: string): void {
    if (this.entries.get(sessionId) === anchorKey) return
    this.entries.delete(sessionId)
    this.entries.set(sessionId, anchorKey)
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.limit) break
      this.entries.delete(oldest)
    }
    try {
      this.storage?.setItem(SEEN_ANSWERS_KEY, JSON.stringify([...this.entries]))
    } catch {
      // A full or unavailable storage keeps this tab's memory.
    }
  }
}
