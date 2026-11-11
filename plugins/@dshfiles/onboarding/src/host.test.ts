import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeServices } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import { onboardingApi } from './api.js'
import { checkGithubAuth } from './github-auth.js'
import onboardingHost from './host.js'

const scratch = mkdtempSync(join(tmpdir(), 'onboarding-gh-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const fakeGh = (name: string, exitCode: number): string => {
  const file = join(scratch, name)
  writeFileSync(file, `#!/bin/sh\necho "Logged in to github.com account someone (keyring)"\nexit ${String(exitCode)}\n`)
  chmodSync(file, 0o755)
  return file
}

const runCheck = (executable: string) =>
  Effect.runPromise(checkGithubAuth({ executable }).pipe(Effect.provide(Layer.merge(NodeServices.layer, DshxEffect.tracerLayer))))

describe('GitHub sign-in check', () => {
  it('records one onboarding gh auth span per run with its status', async () => {
    using recorder = recordSpans()
    expect(await runCheck(fakeGh('gh-signed-in', 0))).toBe('signed-in')
    expect(recorder.span('onboarding gh auth').attributes).toMatchObject({ 'process.executable.name': 'gh', 'onboarding.github.status': 'signed-in' })
  })

  it('tells signed out from missing, and never keeps the output', async () => {
    expect(await runCheck(fakeGh('gh-signed-out', 1))).toBe('signed-out')
    expect(await runCheck(join(scratch, 'no-such-gh'))).toBe('missing')
  })
})

const repository = mkdtempSync(join(tmpdir(), 'onboarding-project-'))
afterAll(() => rmSync(repository, { recursive: true, force: true }))

describe('onboarding Host', () => {
  it('serves the overview over its API and as the read-only onboarding_overview tool', async () => {
    mkdirSync(join(repository, '.jj'))
    const host = await createTestHost()
    host.ctx.provide('settings', {
      configure: () => () => undefined,
      describe: () => [{ ns: 'dshfiles-onboarding', value: { githubCheck: false } }],
      update: async () => undefined,
      replace: async () => undefined,
    } as never)
    host.ctx.provide('workspaceRegistry', {
      list: () => [
        { id: 'w1', title: 'app', path: repository },
        { id: 'w2', title: 'thread', path: `${repository}-threads/thread-abc123` },
      ],
    } as never)
    host.ctx.provide('llm', { listProviders: () => [{ id: 'deepseek' }] } as never)
    host.ctx.provide('pluginManager', {
      listPlugins: async () => [
        { entryId: 'dshfiles-backlog', moduleName: '@dshfiles/backlog', enabled: true, fiberPhase: 'active' },
        { entryId: 'dshfiles-goal-tool', moduleName: '@dshfiles/goal-tool', enabled: false, fiberPhase: null },
      ],
    } as never)
    try {
      await host.mount(onboardingHost, { packageId: '@dshfiles/onboarding' })
      const client = createHostApiClient(host.ctx, onboardingApi, '@test/caller')
      const overview = await client.overview({ query: 'backlog' })
      expect(overview.packs.map(pack => pack.id)).toEqual(['core', 'versioning', 'github', 'planning', 'accounts', 'agents', 'observe', 'knowledge'])
      expect(overview.features.curatedOnly).toBe(false)
      expect(overview.features.rows.some(row => row.plugin === 'backlog')).toBe(true)
      expect(overview.checklist?.map(item => [item.id, item.state])).toEqual([
        ['account', 'done'],
        ['project', 'done'],
        ['repository', 'done'],
        ['github', 'off'],
      ])
      expect(overview.checklist?.find(item => item.id === 'project')?.detail).toBe('1 project added.')
      const planning = overview.packs.find(pack => pack.id === 'planning')?.plugins.map(plugin => [plugin.name, plugin.state])
      expect(planning?.slice(0, 5)).toEqual([
        ['backlog', 'enabled'],
        ['backlog-jira', 'not-installed'],
        ['backlog-notion', 'not-installed'],
        ['goal-tool', 'disabled'],
        ['schedule', 'not-installed'],
      ])

      expect(host.tools.get('onboarding_overview')?.name).toBe('onboarding_overview')
      const result = await host.tools.execute({
        callId: ToolCallId('call-1'),
        name: 'onboarding_overview',
        arguments: { destination: 'land' },
        signal: new AbortController().signal,
      })
      expect(JSON.stringify(result)).toContain('## Setup checklist')
    } finally {
      await host.dispose()
    }
  })
})
