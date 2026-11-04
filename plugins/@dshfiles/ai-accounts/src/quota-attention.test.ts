import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as activityTimeline from '@dshfiles/activity-timeline'
import { attentionApi, type AttentionList } from '@dshfiles/activity-timeline/attention-api'
import { HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import { QUOTA_CONTINUATION_SOURCE, QuotaAttention } from './quota-attention.js'
import type { QuotaContinuationSummary } from './quota-continuation-model.js'
import { createQuotaContinuationService } from './quota-continuation.js'

type SessionPromptRequest = Parameters<SessionController['prompt']>[0]

const summary = (overrides: Partial<QuotaContinuationSummary> = {}): QuotaContinuationSummary => ({
  continuationId: '00000000-0000-4000-8000-000000000001',
  sessionId: 'session-quota',
  accountId: 'codex_work',
  failedProvider: 'codex_work',
  failedModel: 'gpt-6-luna',
  failedAt: 1,
  resetAt: null,
  autoRetry: false,
  snoozedUntil: null,
  state: 'waiting',
  scheduled: false,
  ready: false,
  ...overrides,
})

const until = async (read: () => Promise<AttentionList>, done: (list: AttentionList) => boolean): Promise<AttentionList> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const list = await read()
    if (done(list)) return list
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
  }
  throw new Error('the inbox never reached the expected state')
}

describe('ai-accounts quota inbox provider', () => {
  it('states each waiting continuation as a blocking, resumable item about its thread', () => {
    expect(QuotaAttention.openDrafts([summary({ title: 'Fix login' }), summary({ continuationId: 'queued', state: 'queued' })])).toEqual([
      {
        dedupeKey: '00000000-0000-4000-8000-000000000001',
        subject: { kind: 'session', id: 'session-quota', label: 'Fix login' },
        reason: 'Stopped by the gpt-6-luna on codex_work usage limit.',
        detail:
          'The account did not report when its quota resets. Resume continues the stopped turn now; open the thread to switch it to another account or model first.',
        severity: 'blocking',
        verbs: ['Resume', 'Open', 'Done', 'Snooze', 'MuteSource'],
      },
    ])
  })

  it('lists a quota-blocked thread in the inbox, resumes it on Resume, and resolves a dismissed one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-accounts-attention-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    const host = await createTestHost()
    const prompts: SessionPromptRequest[] = []
    const sessionController = {
      inspect: async () => ({ events: [] }),
      prompt: async (request: SessionPromptRequest) => {
        prompts.push(request)
        return { accepted: true as const }
      },
    }
    // SAFETY: the timeline only injects `agents` to order its activation; it never calls the service.
    const releaseAgents = host.ctx.provide('agents', {} as never)
    let runtime: ManagedRuntime.ManagedRuntime<never, never> | undefined
    const service = createQuotaContinuationService({ context: host.ctx, readResetAt: async () => null, sessionController, now: () => 1_000_000 })
    try {
      await host.ctx.plugin(Storage)
      await host.ctx.plugin(StorageJson, { root: join(root, 'storage') })
      await host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
      await host.mount(activityTimeline, { packageId: '@dshfiles/activity-timeline', native: true })
      runtime = ManagedRuntime.make(
        QuotaAttention.layerFor(() => service).pipe(
          Layer.provideMerge(HostApis.layer),
          Layer.provideMerge(Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/ai-accounts' }))),
        ),
      )
      await runtime.runPromise(Effect.void)
      const inbox = createHostApiClient(host.ctx, attentionApi, '@test/inbox-page')
      const agent = (id: string) => ({ id: SessionId(id), session: { seq: 4 }, inbox: { nextTurn: [], nextStep: [] } })

      await service.recordFailure(agent('session-resume'), 'codex_work', false, { provider: 'codex_work', model: 'gpt-6-luna' })
      host.ctx.emit('dshfiles/attention/ready', { version: 1 })
      const listed = await until(
        () => inbox.list({}),
        list => list.counts.blocking === 1,
      )
      const item = listed.items[0]
      expect(item).toMatchObject({ source: QUOTA_CONTINUATION_SOURCE, subject: { kind: 'session', id: 'session-resume' }, severity: 'blocking' })

      expect(await inbox.act({ id: item?.id ?? '', verb: 'Resume' })).toEqual({ ok: true, message: 'Resumed: the stopped turn is queued on its thread.' })
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toMatchObject({ sessionId: 'session-resume', mode: 'queue' })
      await until(
        () => inbox.list({}),
        list => list.counts.blocking === 0,
      )

      await service.recordFailure(agent('session-dismiss'), 'codex_work', false)
      host.ctx.emit('dshfiles/attention/ready', { version: 1 })
      const second = await until(
        () => inbox.list({}),
        list => list.counts.blocking === 1,
      )
      const continuationId = second.items[0]?.dedupeKey ?? ''
      expect(await service.dismiss(continuationId)).toEqual({ dismissed: true })
      host.ctx.emit('dshfiles/attention/ready', { version: 1 })
      await until(
        () => inbox.list({}),
        list => list.counts.blocking === 0,
      )
      const closed = await inbox.list({ view: 'closed' })
      expect(closed.items.map(entry => [entry.subject.id, entry.resolvedAt !== null])).toEqual(
        expect.arrayContaining([
          ['session-resume', true],
          ['session-dismiss', true],
        ]),
      )
    } finally {
      await runtime?.dispose()
      await service.close()
      releaseAgents()
      await host.dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
