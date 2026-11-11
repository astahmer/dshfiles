import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { createHostApiClient, defineHost } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { threadActionsApi } from '@dshfiles/thread-sidebar/thread-actions-api'
import { usageApi } from '@dshfiles/usage/api'
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
    host.ctx.provide('subprocess', {} as never)
    host.ctx.provide('llm', { listProviders: () => [{ id: 'deepseek' }] } as never)
    const writes: string[] = []
    host.ctx.provide('pluginManager', {
      listPlugins: async () => [
        { entryId: 'dshfiles-backlog', moduleName: '@dshfiles/backlog', enabled: true, fiberPhase: 'active' },
        { entryId: 'dshfiles-goal-tool', moduleName: '@dshfiles/goal-tool', enabled: false, fiberPhase: null },
      ],
      setPluginEnabled: async (id: string, enabled: boolean) => {
        writes.push(`${id}=${String(enabled)}`)
        return { changed: true, application: 'restart-required', restartReason: 'no-hmr', stage: 'enable', target: id }
      },
      listBundles: async () => [],
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

      const preview = await client.overview({ preview: { pack: 'planning', action: 'enable' }, limit: 1 })
      expect(preview.preview).toMatchObject({ change: [{ plugin: 'goal-tool', entryIds: ['dshfiles-goal-tool'] }], installMode: 'manual' })
      expect(writes).toEqual([])
    } finally {
      await host.dispose()
    }
  })

  it('serves one feature reach steps over its API and as the read-only onboarding_reach tool', async () => {
    const host = await createTestHost()
    host.ctx.provide('settings', {
      configure: () => () => undefined,
      describe: () => [{ ns: 'dshfiles-onboarding', value: { githubCheck: false, checklist: false } }],
      update: async () => undefined,
      replace: async () => undefined,
    } as never)
    host.ctx.provide('subprocess', {} as never)
    try {
      await host.mount(onboardingHost, { packageId: '@dshfiles/onboarding' })
      const client = createHostApiClient(host.ctx, onboardingApi, '@test/caller')
      const settings = await client.reach({ key: 'settings-shell#settings-shell-port' })
      expect(settings.feature).toMatchObject({ walkable: true, unsupportedActions: [], destination: 'settings' })
      expect(settings.feature?.steps.map(step => [step.action, step.locator, step.unsupported])).toEqual([
        ['click', { kind: 'role', role: 'button', name: 'Account menu', match: 'exact' }, null],
        ['click', { kind: 'role', role: 'menuitem', name: 'Settings', match: 'substring' }, null],
        ['expect', { kind: 'role', role: 'button', name: 'General', match: 'exact' }, null],
      ])
      const seeded = await client.reach({ key: 'thread-sidebar#rename-thread-title' })
      expect(seeded.feature).toMatchObject({ walkable: false, unsupportedActions: ['rightclick', 'seed'] })
      expect((await client.reach({ key: 'nothing#here' })).feature).toBeNull()
      await expect(client.reach({ key: '../etc' })).rejects.toThrow()

      const tool = host.tools.get('onboarding_reach')
      expect(tool?.name).toBe('onboarding_reach')
      expect(tool?.isConcurrencySafe?.({})).toBe(true)
      const text = JSON.stringify(
        await host.tools.execute({
          callId: ToolCallId('call-reach'),
          name: 'onboarding_reach',
          arguments: { key: 'thread-sidebar#idle-archive-policy' },
          signal: new AbortController().signal,
        }),
      )
      expect(text).toContain('1. Click \\"All threads\\" (button)')
      expect(text).toContain('Right-click \\"Idle policy target\\" (text) — not replayable here')
      expect(text).toContain('Docs: https://github.com/astahmer/dshfiles/blob/main/plugins/@dshfiles/thread-sidebar/README.md')
    } finally {
      await host.dispose()
    }
  })

  it('serves What’s new as the read-only onboarding_whats_new tool, and reads no history while the setting is off', async () => {
    const mount = async (whatsNew: boolean) => {
      const host = await createTestHost()
      host.ctx.provide('settings', {
        configure: () => () => undefined,
        describe: () => [{ ns: 'dshfiles-onboarding', value: { githubCheck: false, checklist: false, whatsNew } }],
        update: async () => undefined,
        replace: async () => undefined,
      } as never)
      host.ctx.provide('subprocess', {} as never)
      const bundleReads: string[] = []
      host.ctx.provide('pluginManager', {
        listPlugins: async () => [],
        setPluginEnabled: async () => ({ changed: false, application: 'applied' }),
        listBundles: async () => {
          bundleReads.push('read')
          return [{ name: '@dshfiles/onboarding' }]
        },
      } as never)
      await host.mount(onboardingHost, { packageId: '@dshfiles/onboarding' })
      return { host, bundleReads }
    }
    const off = await mount(false)
    try {
      const client = createHostApiClient(off.host.ctx, onboardingApi, '@test/caller')
      expect(await client.whatsNew({})).toEqual({ state: 'off' })
      expect(off.bundleReads).toEqual([])
    } finally {
      await off.host.dispose()
    }
    const on = await mount(true)
    try {
      const tool = on.host.tools.get('onboarding_whats_new')
      expect(tool?.isConcurrencySafe?.({})).toBe(true)
      const text = JSON.stringify(
        await on.host.tools.execute({
          callId: ToolCallId('call-whats-new'),
          name: 'onboarding_whats_new',
          arguments: { limit: 5 },
          signal: new AbortController().signal,
        }),
      )
      expect(on.bundleReads).toEqual(['read'])
      expect(text).toContain('does not link Getting started from a dshfiles checkout')
      expect(text).toContain('https://github.com/astahmer/dshfiles/commits/main')
    } finally {
      await on.host.dispose()
    }
  })

  it('records one onboarding history read span for a checkout read through the mounted Host', async () => {
    const root = join(scratch, 'history-checkout')
    mkdirSync(join(root, 'plugins', '@dshfiles', 'onboarding'), { recursive: true })
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts', 'profile-sync.ts'), '')
    const git = (args: readonly string[]) =>
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, stdio: 'ignore' })
    git(['init', '--quiet', '--initial-branch=main'])
    git(['commit', '--quiet', '--allow-empty', '-m', 'feat(backlog): capture from anywhere'])
    const host = await createTestHost()
    host.ctx.provide('settings', {
      configure: () => () => undefined,
      describe: () => [{ ns: 'dshfiles-onboarding', value: { githubCheck: false, checklist: false, whatsNew: true } }],
      update: async () => undefined,
      replace: async () => undefined,
    } as never)
    // A real spawn, as the DSH subprocess service does it, so the Host reads the fixture's history.
    host.ctx.provide('subprocess', {
      resolveExecutable: async (name: string) => name,
      spawn: (spec: { readonly argv: readonly string[]; readonly cwd: string }) => {
        const [executable = '', ...args] = spec.argv
        const child = spawn(executable, args, { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = new Promise<{ readonly exitCode: number | null; readonly signal: string | null }>(resolve => {
          child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
          child.on('error', () => resolve({ exitCode: null, signal: null }))
        })
        return {
          done: exited,
          waitForExit: async () => {
            await exited
            return true
          },
          terminate: () => child.kill('SIGKILL'),
          stdout: child.stdout,
          stderr: child.stderr,
        }
      },
    } as never)
    host.ctx.provide('pluginManager', {
      listPlugins: async () => [],
      setPluginEnabled: async () => ({ changed: false, application: 'applied' }),
      listBundles: async () => [{ name: '@dshfiles/onboarding', source: `link:${join(root, 'plugins', '@dshfiles', 'onboarding')}` }],
    } as never)
    await host.mount(onboardingHost, { packageId: '@dshfiles/onboarding' })
    try {
      using recorder = recordSpans()
      const client = createHostApiClient(host.ctx, onboardingApi, '@test/caller')
      const first = await client.whatsNew({})
      expect(first.state).toBe('ready')
      await client.whatsNew({})
      expect(recorder.named('onboarding history read')).toHaveLength(1)
      expect(recorder.span('onboarding history read').attributes).toMatchObject({ 'onboarding.history.state': 'ready', 'onboarding.history.vcs': 'git' })
    } finally {
      await host.dispose()
    }
  })

  it('reads no usage while suggestions are off, and serves onboarding_suggestions from cached aggregate counts once on', async () => {
    const reads: string[] = []
    const unused = (): never => {
      throw new Error('not read by onboarding')
    }
    const fakeUsage = defineHost({
      apis: [
        usageApi.host({
          activity: ({ input }) => {
            reads.push(`activity:${String(input.days)}`)
            return {
              timelineBucket: 'day',
              tools: [
                { name: 'bash', calls: 120, errors: 0, interrupted: 0, unknown: 0, averageDurationMs: null },
                { name: 'todo_write', calls: 3, errors: 0, interrupted: 0, unknown: 0, averageDurationMs: null },
              ],
              commandDistribution: [{ command: 'jj squash', calls: 84, totalDurationMs: 1_000 }],
              jev: { calls: 0, successes: 0, failures: 0, averageDurationMs: null },
            }
          },
          charts: ({ input }) => {
            reads.push(`charts:${input.groupBy}`)
            return {
              summary: {
                cost: 0,
                requests: 0,
                failed: 0,
                aborted: 0,
                input: 0,
                cacheRead: 0,
                cacheWrite: 0,
                output: 0,
                unpriced: 0,
                turns: 12,
                previous: { cost: 0, requests: 0, tokens: 0 },
              },
              keys: [],
              buckets: [],
              breakdown: { model: [], provider: [], project: [], purpose: [] },
              latency: [],
              topThreads: [{ sessionId: 'session-1', title: 'never leaves usage', project: null, cost: 0, requests: 30 }],
            }
          },
          requests: unused,
          familyCost: unused,
          status: unused,
          jevUsage: unused,
          recordJevUsage: unused,
          refresh: unused,
          otelMetrics: unused,
        }),
      ],
    })
    const mount = async (suggestions: boolean, withUsage: boolean) => {
      const host = await createTestHost()
      host.ctx.provide('settings', {
        configure: () => () => undefined,
        describe: () => [{ ns: 'dshfiles-onboarding', value: { githubCheck: false, checklist: false, suggestions } }],
        update: async () => undefined,
        replace: async () => undefined,
      } as never)
      host.ctx.provide('subprocess', {} as never)
      if (withUsage) await host.mount(fakeUsage, { packageId: '@dshfiles/usage' })
      await host.mount(onboardingHost, { packageId: '@dshfiles/onboarding' })
      return host
    }
    const execute = (host: Awaited<ReturnType<typeof createTestHost>>, id: string) =>
      host.tools.execute({ callId: ToolCallId(id), name: 'onboarding_suggestions', arguments: {}, signal: new AbortController().signal }).then(
        value => JSON.stringify(value),
        (error: unknown) => String(error),
      )

    const off = await mount(false, true)
    try {
      const client = createHostApiClient(off.ctx, onboardingApi, '@test/caller')
      await expect(client.suggestions({})).rejects.toThrow(/suggestions are off/u)
      expect(await execute(off, 'call-off')).toMatch(/Usage suggestions are off, so no usage was read/u)
      expect(off.tools.get('onboarding_suggestions')?.isConcurrencySafe?.({})).toBe(true)
      expect(reads).toEqual([])
    } finally {
      await off.dispose()
    }

    const absent = await mount(true, false)
    try {
      const value = await createHostApiClient(absent.ctx, onboardingApi, '@test/caller').suggestions({})
      expect(value).toMatchObject({ state: 'no-usage' })
      expect(value.state === 'no-usage' ? value.reason : '').toMatch(/Enable it in Settings › Plugins/u)
    } finally {
      await absent.dispose()
    }

    const on = await mount(true, true)
    try {
      using recorder = recordSpans()
      const client = createHostApiClient(on.ctx, onboardingApi, '@test/caller')
      const value = await client.suggestions({})
      expect(value.state === 'ready' ? value.suggestions.map(entry => [entry.rule, entry.evidence, entry.feature.key]) : value).toEqual([
        ['jj-without-thread-workspaces', '84 jj commands, no thread workspace yet', 'jj-integration#thread-destination'],
        ['jj-without-revision-graph', '84 jj commands, no revision graph read', 'jujutsu#revision-graph'],
      ])
      expect(JSON.stringify(value)).not.toContain('never leaves usage')
      expect(JSON.stringify(value)).not.toContain('squash')
      expect(recorder.span('onboarding suggestions read').attributes).toMatchObject({
        'onboarding.suggestions.state': 'ready',
        'onboarding.suggestions.count': 2,
      })
      expect(await execute(on, 'call-on')).toContain('jj-integration#thread-destination')
      expect(reads).toEqual(['activity:30', 'charts:purpose'])
      expect(recorder.named('onboarding suggestions read')).toHaveLength(1)
    } finally {
      await on.dispose()
    }
  })

  it('refuses a bare onboarding_pack_apply request, and relays the plugin manager verdict once confirmed', async () => {
    const host = await createTestHost()
    host.ctx.provide('settings', {
      configure: () => () => undefined,
      describe: () => [{ ns: 'dshfiles-onboarding', value: { githubCheck: false, checklist: false } }],
      update: async () => undefined,
      replace: async () => undefined,
    } as never)
    host.ctx.provide('subprocess', {} as never)
    const writes: string[] = []
    host.ctx.provide('pluginManager', {
      listPlugins: async () => [{ entryId: 'dshfiles-goal-tool', moduleName: '@dshfiles/goal-tool', enabled: false, fiberPhase: null }],
      setPluginEnabled: async (id: string, enabled: boolean) => {
        writes.push(`${id}=${String(enabled)}`)
        return { changed: true, application: 'restart-required', restartReason: 'no-hmr', stage: 'enable', target: id }
      },
      listBundles: async () => [],
    } as never)
    try {
      await host.mount(onboardingHost, { packageId: '@dshfiles/onboarding' })
      const execute = (args: { readonly pack: string; readonly action: string; readonly confirm?: true; readonly plugins?: readonly string[] }) =>
        host.tools.execute({
          callId: ToolCallId(`call-${String(writes.length)}`),
          name: 'onboarding_pack_apply',
          arguments: args,
          signal: new AbortController().signal,
        })
      const bare = await execute({ pack: 'planning', action: 'enable' }).then(
        value => JSON.stringify(value),
        (error: unknown) => String(error),
      )
      expect(bare).toMatch(/confirm/u)
      expect(writes).toEqual([])

      const applied = JSON.stringify(await execute({ pack: 'planning', action: 'enable', confirm: true, plugins: ['goal-tool'] }))
      expect(writes).toEqual(['dshfiles-goal-tool=true'])
      expect(applied).toContain('restart reason: no-hmr')
      expect(applied).toContain('"results":[{"plugin":"goal-tool"')
    } finally {
      await host.dispose()
    }
  })

  it('starts no demo thread while tryIt is off or without confirm, and once on sends the catalog prompt through thread actions', async () => {
    const created: { readonly title: string | undefined; readonly text: string | undefined; readonly cwd: string | undefined }[] = []
    const unused = (): never => {
      throw new Error('not called by onboarding')
    }
    const fakeThreadActions = defineHost({
      apis: [
        threadActionsApi.host({
          create: ({ input }) => {
            created.push({ title: input.title, text: input.text, cwd: input.cwd })
            return { sessionId: 'session-demo', title: input.title ?? 'untitled', prompt: 'accepted' as const }
          },
          list: unused,
          archive: unused,
          unarchive: unused,
          settle: unused,
          unsettle: unused,
          pin: unused,
          unpin: unused,
          rename: unused,
          fork: unused,
          continueIn: unused,
          fanOut: unused,
          prompt: unused,
          stop: unused,
          selectModel: unused,
          status: unused,
          references: unused,
          projectList: unused,
          projectRegister: unused,
          projectRename: unused,
          projectDelete: unused,
          projectReorder: unused,
          move: unused,
        }),
      ],
    })
    const mount = async (input: { readonly tryIt: boolean; readonly withThreadActions: boolean }) => {
      const host = await createTestHost()
      host.ctx.provide('settings', {
        configure: () => () => undefined,
        describe: () => [{ ns: 'dshfiles-onboarding', value: { githubCheck: false, checklist: false, tryIt: input.tryIt } }],
        update: async () => undefined,
        replace: async () => undefined,
      } as never)
      host.ctx.provide('subprocess', {} as never)
      if (input.withThreadActions) await host.mount(fakeThreadActions, { packageId: '@dshfiles/thread-sidebar' })
      await host.mount(onboardingHost, { packageId: '@dshfiles/onboarding' })
      return host
    }
    const execute = (host: Awaited<ReturnType<typeof createTestHost>>, args: { readonly feature?: string; readonly pack?: string; readonly confirm?: true }) =>
      host.tools
        .execute({ callId: ToolCallId(`call-${String(created.length)}`), name: 'onboarding_try_it', arguments: args, signal: new AbortController().signal })
        .then(
          value => JSON.stringify(value),
          (error: unknown) => String(error),
        )

    const off = await mount({ tryIt: false, withThreadActions: true })
    try {
      expect(await execute(off, { feature: 'onboarding#usage-suggestions', confirm: true })).toMatch(/Try it is off, so no thread was started/u)
      await expect(createHostApiClient(off.ctx, onboardingApi, '@test/caller').tryIt({ pack: 'observe', confirm: true })).rejects.toThrow(/Try it is off/u)
      expect(off.tools.get('onboarding_try_it')?.isConcurrencySafe?.({})).not.toBe(true)
      expect(created).toEqual([])
    } finally {
      await off.dispose()
    }

    const absent = await mount({ tryIt: true, withThreadActions: false })
    try {
      expect(await execute(absent, { feature: 'onboarding#usage-suggestions', confirm: true })).toMatch(/Enable thread-sidebar in Settings › Plugins/u)
    } finally {
      await absent.dispose()
    }

    const on = await mount({ tryIt: true, withThreadActions: true })
    try {
      expect(await execute(on, { feature: 'onboarding#usage-suggestions' })).toMatch(/confirm/u)
      expect(await execute(on, { feature: 'onboarding#no-such-feature', confirm: true })).toMatch(/Name exactly one catalogued/u)
      expect(await execute(on, { feature: 'onboarding#usage-suggestions', pack: 'observe', confirm: true })).toMatch(/Name exactly one catalogued/u)
      expect(created).toEqual([])

      const started = await execute(on, { feature: 'onboarding#usage-suggestions', confirm: true })
      expect(started).toContain('Started the demo thread session-demo')
      expect(created).toHaveLength(1)
      expect(created[0]?.title).toBe('Try it · Get features suggested from what you already do')
      expect(created[0]?.text).toContain('catalog key `onboarding#usage-suggestions`')
      expect(created[0]?.text).toContain('Ask me before any write')

      const client = createHostApiClient(on.ctx, onboardingApi, '@test/caller')
      expect(await client.tryIt({ pack: 'observe', confirm: true })).toEqual({
        sessionId: 'session-demo',
        title: 'Try it · Observe & perf',
        prompt: 'accepted',
        promptError: null,
      })
      expect(created[1]?.cwd).toBeUndefined()
    } finally {
      await on.dispose()
    }
  })
})
