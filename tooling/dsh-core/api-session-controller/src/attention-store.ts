import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'
import type { SessionAttentionSummary } from './types.ts'

const attentionRecordSchema = z.object({
  lastPromptSeq: z.number().int().nonnegative().nullable(),
  readThroughSeq: z.number().int().min(-1),
  snoozed: z.boolean(),
}).strict()

type AttentionRecord = z.infer<typeof attentionRecordSchema>

export const sessionAttentionDomainSpec = defineDomain({
  name: 'dsh_api_session_attention',
  version: 1,
  layout: 'per-record',
  tables: { sessions: domainTable(attentionRecordSchema) },
})

const initialAttention = (): AttentionRecord => ({
  lastPromptSeq: null,
  readThroughSeq: -1,
  snoozed: false,
})

const summarize = (record: AttentionRecord): SessionAttentionSummary => ({
  ...record,
  unread: record.lastPromptSeq !== null && record.lastPromptSeq > record.readThroughSeq,
})

export class SessionAttentionStore {
  private domain: Domain<typeof sessionAttentionDomainSpec> | undefined
  private writeTail: Promise<void> = Promise.resolve()

  async open(storageDomain: Context['storageDomain']): Promise<void> {
    if (this.domain !== undefined) return
    this.domain = await storageDomain.open(sessionAttentionDomainSpec)
  }

  summary(sessionId: SessionId): SessionAttentionSummary | null {
    const record = this.domain?.table('sessions').get(sessionId)
    return record === undefined ? null : summarize(record)
  }

  notePrompt(sessionId: SessionId, seq: number): Promise<SessionAttentionSummary> {
    return this.update(sessionId, current => ({
      ...current,
      lastPromptSeq: current.lastPromptSeq === null ? seq : Math.max(current.lastPromptSeq, seq),
    }))
  }

  markRead(sessionId: SessionId, throughSeq: number): Promise<SessionAttentionSummary> {
    return this.update(sessionId, current => ({
      ...current,
      readThroughSeq: Math.max(current.readThroughSeq, throughSeq),
    }))
  }

  setSnoozed(sessionId: SessionId, snoozed: boolean): Promise<SessionAttentionSummary> {
    return this.update(sessionId, current => ({ ...current, snoozed }))
  }

  async flush(): Promise<void> {
    await this.writeTail
  }

  async close(): Promise<void> {
    const domain = this.domain
    if (domain === undefined) return
    await this.flush()
    await domain.close()
    if (this.domain === domain) this.domain = undefined
  }

  private update(
    sessionId: SessionId,
    change: (current: AttentionRecord) => AttentionRecord,
  ): Promise<SessionAttentionSummary> {
    const domain = this.domain
    if (domain === undefined) return Promise.reject(new Error('Session attention store is not open'))
    const result = this.writeTail.then(async () => {
      const sessions = domain.table('sessions')
      const current = sessions.get(sessionId) ?? initialAttention()
      const next = change(current)
      await sessions.put(sessionId, next)
      return summarize(next)
    })
    this.writeTail = result.then(() => undefined, () => undefined)
    return result
  }
}
