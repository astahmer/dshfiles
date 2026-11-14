import { NodeServices } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { afterEach, expect, it } from 'vitest'
import { SystemctlRunner, type SystemctlRequest } from '../src/native/systemctl-runner.ts'

/** A runner whose helper forks are counted: each one is a fork of the (large) Host. */
function makeRunner() {
  const forks = { count: 0 }
  const countingSpawner = Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.gen(function* () {
      const real = yield* ChildProcessSpawner.ChildProcessSpawner
      return ChildProcessSpawner.make(command => {
        forks.count += 1
        return real.spawn(command)
      })
    }),
  ).pipe(Layer.provide(NodeServices.layer))
  const runtime = ManagedRuntime.make(SystemctlRunner.layerWithoutSpawner.pipe(Layer.provide(countingSpawner)))
  runtimes.push(runtime)
  const run = (request: Omit<SystemctlRequest, 'env' | 'timeoutMs'> & Partial<SystemctlRequest>) =>
    runtime.runPromise(SystemctlRunner.use(runner => runner.run({ env: process.env, timeoutMs: 3_000, ...request })))
  return { run, forks, runtime }
}

const runtimes: ManagedRuntime.ManagedRuntime<SystemctlRunner, never>[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()))
})

const node = process.execPath

it('forks the Host once for a burst of sequential commands', async () => {
  const { run, forks } = makeRunner()
  for (let index = 0; index < 5; index++) {
    expect(await run({ command: node, args: ['-e', `console.log(${index})`] })).toEqual({ status: 0, stdout: `${index}\n`, stderr: '' })
  }
  expect(forks.count).toBe(1)
})

it('passes argv literally and reports a failing exit status', async () => {
  const { run } = makeRunner()
  const result = await run({ command: node, args: ['-e', 'console.log(process.argv[1]); process.exit(7)', '$HOME;echo unsafe'] })
  expect(result.status).toBe(7)
  expect(result.stdout).toBe('$HOME;echo unsafe\n')
  expect(result.error).toBeInstanceOf(Error)
})

it('runs concurrent commands in parallel helpers', async () => {
  const { run, forks } = makeRunner()
  const wait = { command: node, args: ['-e', 'setTimeout(() => {}, 400)'] }
  const started = performance.now()
  const results = await Promise.all([run(wait), run(wait), run(wait)])
  expect(results.map(result => result.status)).toEqual([0, 0, 0])
  expect(performance.now() - started).toBeLessThan(1_000)
  expect(forks.count).toBe(3)
})

it('bounds a stuck command, then serves the next one', async () => {
  const { run } = makeRunner()
  const stuck = await run({ command: node, args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 100 })
  expect(stuck.status).toBeNull()
  expect(stuck.error).toBeInstanceOf(Error)
  expect((await run({ command: node, args: ['-e', ''] })).status).toBe(0)
})

it('reports a missing command as a failed result, not a rejection', async () => {
  const { run } = makeRunner()
  const missing = await run({ command: '/nonexistent/systemctl', args: [] })
  expect(missing.status).toBeNull()
  expect(missing.error?.message).toMatch(/ENOENT/u)
})

it('settles a command in flight when the runtime is disposed', async () => {
  const { run, runtime } = makeRunner()
  const outcome = run({ command: node, args: ['-e', 'setInterval(() => {}, 1000)'] }).then(
    () => 'answered',
    () => 'interrupted',
  )
  await new Promise(resolve => setTimeout(resolve, 200))
  await runtime.dispose()
  expect(await outcome).toBe('interrupted')
})
