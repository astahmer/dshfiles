import { Context } from '@deepseek-ai/cordis'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, expect, it, vi } from 'vitest'
import { apply } from '../src/host.ts'

const contexts: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const bash = (command: string): SubprocessSpawnSpec => ({
  argv: ['bash', '-c', command],
  cwd: process.cwd(),
  stdio: { stdin: 'ignore', stdout: { maxBytes: 64_000, spill: { maxBytes: 1_000_000 } }, stderr: 'pipe' },
  graceMs: 200,
})

const runtime = async (): Promise<Context['subprocess']> => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin({ name: 'subprocess-local-test', apply })
  return ctx.subprocess
}

it.skipIf(process.platform === 'win32')('runs a command and reports its output', async () => {
  const handle = (await runtime()).spawn(bash('echo managed'))
  await expect(handle.done).resolves.toMatchObject({ exitCode: 0 })
  expect(handle.collected.stdout?.readFrom(0).text).toBe('managed\n')
})

it.skipIf(process.platform === 'win32')('waits for a backgrounded child without probing its group every 15 ms', async () => {
  const handle = (await runtime()).spawn(bash('sleep 1.5 & echo started'))
  await handle.done
  const kill = vi.spyOn(process, 'kill')
  const started = performance.now()
  await expect(handle.waitForExit()).resolves.toBe(true)
  const waited = performance.now() - started
  const groupProbes = kill.mock.calls.filter(([pid, signal]) => pid < 0 && signal === 0).length
  expect(waited).toBeGreaterThan(1_000)
  expect(waited).toBeLessThan(2_500)
  // A fixed 15 ms cadence probes about 100 times over 1.5 s.
  expect(groupProbes).toBeLessThan(20)
})
