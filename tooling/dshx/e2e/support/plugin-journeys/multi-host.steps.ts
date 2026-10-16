import { expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { After, Given, Then, When } from '../bdd.js'
import { bootComposedPluginProfile, type BootedProfile } from '../boot.js'
import { startLoopbackSshd } from '../loopback-sshd.mjs'
import { finishJourneyAssertions, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'
import { connectDshxApi } from '../../../packages/dshx/src/platform/dshx-api.js'
import { z } from 'zod'

const multiHostPackageId = '@dshfiles/multi-host'
const jjIntegrationPackageId = '@dshfiles/jj-integration'
const multiHostApiId = 'multi-host'
const scratchRemoteName = 'Scratch SSH runtime'

const nativeCreateSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.object({ sessionId: z.string() }).passthrough() }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
])

const nativeSessionListSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.object({ items: z.array(z.object({ sessionId: z.string() }).passthrough()) }).passthrough() }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
])

const transcriptSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), cwd: z.string(), entries: z.array(z.unknown()) }).passthrough(),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }).passthrough(),
])

const runtimeDirectorySchema = z.object({
  hosts: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
  runtimes: z.array(z.object({ id: z.string(), hostId: z.string(), name: z.string(), remoteHome: z.string(), connected: z.boolean() }).passthrough()),
})

type MultiHostScratchPair = {
  readonly sshd: Awaited<ReturnType<typeof startLoopbackSshd>>
  readonly remote: BootedProfile
  readonly manager: BootedProfile
  readonly wrapperInvocationLogPath: string
}

const pairs = new WeakMap<Page, MultiHostScratchPair>()

const pairFor = (page: Page): MultiHostScratchPair => {
  const pair = pairs.get(page)
  if (pair === undefined) throw new Error('The loopback second-DSH fixture was not initialized.')
  return pair
}
type JourneyObservation = {
  readonly runtimeId: string
  readonly remoteHome: string
  readonly sessionId: string
  readonly transcriptCwd: string
}

const observations = new WeakMap<Page, JourneyObservation>()

const hostApi = async (profile: BootedProfile) => connectDshxApi({ url: profile.url, packageId: multiHostPackageId, apiId: multiHostApiId, version: 1 })

Given('a loopback SSH DSH pair is booted', async ({ page }: { readonly page: Page }) => {
  const sshd = await startLoopbackSshd()
  let remote: BootedProfile | undefined
  let manager: BootedProfile | undefined
  try {
    remote = await bootComposedPluginProfile({ packageIds: [multiHostPackageId], profileLabel: 'multi-host-remote' })
    let wrapperInvocationLogPath: string | undefined
    manager = await bootComposedPluginProfile({
      packageIds: [multiHostPackageId, jjIntegrationPackageId],
      profileLabel: 'multi-host-manager',
      seedHome: async homeRoot => {
        const seeded = await sshd.seedClientHome(homeRoot)
        wrapperInvocationLogPath = seeded.wrapperInvocationLogPath
        return { hostPathPrefix: seeded.hostPathPrefix }
      },
    })
    if (wrapperInvocationLogPath === undefined) throw new Error('The scratch SSH wrapper was not seeded for the manager DSH.')
    pairs.set(page, { sshd, remote, manager, wrapperInvocationLogPath })
    await visitIsolatedPluginProfile(page, manager)
  } catch (error) {
    try {
      await manager?.close()
    } finally {
      try {
        await remote?.close()
      } finally {
        await sshd.close()
      }
    }
    throw error
  }
})

When('the scratch remote is added from the host UI', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  await page.getByRole('button', { name: 'Run on Local', exact: true }).click()
  await page.getByText('Add host…', { exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add host', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('SSH destination').fill(pair.sshd.targetAlias)
  await dialog.getByLabel('Name').fill(scratchRemoteName)
  await dialog.getByLabel('Remote DSH home').fill(pair.remote.homeRoot)
  await dialog.getByRole('button', { name: 'Add host', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: `Run on ${scratchRemoteName}`, exact: true })).toBeVisible()
  const wrapperCalls = (await readFile(pair.wrapperInvocationLogPath, 'utf8')).trim().split(/\r?\n/)
  expect(wrapperCalls).toContain('invoked')
})

When('a remote thread is created and read over SSH', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const call = await hostApi(pair.manager)
  const directory = runtimeDirectorySchema.parse(await call('list'))
  const host = directory.hosts.find(item => item.name === scratchRemoteName)
  if (host === undefined) throw new Error('The saved scratch SSH host was not listed by the manager DSH.')
  const runtime = directory.runtimes.find(item => item.hostId === host.id)
  if (runtime === undefined) throw new Error('The scratch SSH host did not register a remote DSH runtime.')

  const created = nativeCreateSchema.parse(
    await call('runtimeCall', {
      runtimeId: runtime.id,
      request: { namespace: 'session', method: 'create', args: { request: { cwd: pair.remote.homeRoot } } },
    }),
  )
  if (!created.ok) throw new Error(`The remote session could not be created: ${created.code}.`)
  const sessionId = created.value.sessionId
  const transcript = transcriptSchema.parse(await call('threadTranscript', { runtimeId: runtime.id, sessionId }))
  if (!transcript.ok) throw new Error(`The remote thread transcript could not be read: ${transcript.code}.`)
  const sessions = nativeSessionListSchema.parse(
    await call('runtimeCall', {
      runtimeId: runtime.id,
      request: { namespace: 'session', method: 'list', args: { _request: {} } },
    }),
  )
  if (!sessions.ok) throw new Error(`The remote session list could not be read: ${sessions.code}.`)
  expect(sessions.value.items.some(item => item.sessionId === sessionId)).toBe(true)
  expect(transcript.cwd).toBe(pair.remote.homeRoot)
  observations.set(page, { runtimeId: runtime.id, remoteHome: runtime.remoteHome, sessionId, transcriptCwd: transcript.cwd })
})

Then('the second scratch DSH is ready and the remote thread round-trips', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const observation = observations.get(page)
  if (observation === undefined) throw new Error('The remote thread journey did not produce an observation.')
  const call = await hostApi(pair.manager)
  const ping = z
    .discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), ms: z.number().int().nonnegative() }),
      z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
    ])
    .parse(await call('runtimePing', { runtimeId: observation.runtimeId }))
  expect(ping.ok).toBe(true)
  expect(observation.remoteHome).toBe(pair.remote.homeRoot)
  expect(observation.sessionId).not.toBe('')
  await recordAssertion(page, 'multi-host-scratch-ready', async () => expect(ping.ok).toBe(true))
  await recordAssertion(page, 'multi-host-thread-roundtrip', async () => expect(observation.transcriptCwd).toBe(pair.remote.homeRoot))
  await finishJourneyAssertions(page)
})

After(async ({ page }: { readonly page: Page }) => {
  observations.delete(page)
  const pair = pairs.get(page)
  if (pair === undefined) return
  pairs.delete(page)
  try {
    await pair.manager.close()
  } finally {
    try {
      await pair.remote.close()
    } finally {
      await pair.sshd.close()
    }
  }
})
