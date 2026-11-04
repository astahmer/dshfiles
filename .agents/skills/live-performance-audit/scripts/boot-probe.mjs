// Cold scratch Host boot: prepare the composed scratch profile, spawn the Host, then poll an authenticated RPC until it answers.
// Usage: node boot-probe.mjs <workspace>   (CPU_PROF_DIR=<dir> adds --cpu-prof, DUMP_HOST=1 prints the tail of the host log)
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const workspace = resolve(process.argv[2] ?? process.cwd())
const dist = resolve(workspace, 'tooling/dshx/packages/dshx/dist')
const { prepareComposedBootProfile } = await import(resolve(dist, 'project/boot-profile.js'))
const { LocalBundleModel, findFreePort } = await import(resolve(dist, 'project/local-bundles.js'))
const { ScratchProfileRuntime } = await import(resolve(dist, 'project/scratch-profile.js'))
const { resolveDshExecutable } = await import(resolve(dist, 'project/dsh-executable.js'))

const started = performance.now()
const available = await LocalBundleModel.listLocalBootBundles()
const selected = LocalBundleModel.resolveLocalBundles(
  available.map(bundle => bundle.packageId),
  available,
)
const bundles = LocalBundleModel.withSharedStylesheet(selected, available)
const profile = await prepareComposedBootProfile(
  bundles.map(bundle => ({ projectRoot: bundle.projectRoot, packageId: bundle.packageId })),
  { sourceProfileRoot: resolve(workspace, 'profiles/web') },
)
const prepareMs = Math.round(performance.now() - started)

const executable = await resolveDshExecutable(undefined, process.env, workspace)
const port = await findFreePort()
const hostArgs = ['--profile', profile.profile, '--port', String(port), '--no-open']
if (process.env.CPU_PROF_DIR !== undefined)
  hostArgs.unshift('--cpu-prof', `--cpu-prof-dir=${process.env.CPU_PROF_DIR}`, `--cpu-prof-name=${workspace.split('/').at(-1)}-${Date.now()}.cpuprofile`)

const spawnAt = performance.now()
const child = spawn(executable, hostArgs, {
  cwd: workspace,
  env: ScratchProfileRuntime.hostEnvironment(profile.homeRoot, profile.profileRoot),
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
let firstOutputAt = null
const collect = chunk => {
  firstOutputAt ??= performance.now()
  output += chunk.toString('utf8')
}
child.stdout.on('data', collect)
child.stderr.on('data', collect)

const urlPattern = /https?:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/i
const deadline = Date.now() + 180_000
let launchUrl
let urlAt = null
while (Date.now() < deadline) {
  const match = urlPattern.exec(output)
  if (match !== null) {
    launchUrl = match[0]
    urlAt = performance.now()
    break
  }
  if (child.exitCode !== null) break
  await new Promise(done => setTimeout(done, 20))
}

let readyAt = null
if (launchUrl !== undefined) {
  const landing = await fetch(launchUrl, { redirect: 'manual' })
  const cookie = landing.headers
    .getSetCookie()
    .map(value => value.split(';')[0])
    .join('; ')
  const origin = new URL(launchUrl).origin
  for (;;) {
    try {
      const answer = await fetch(`${origin}/api/credentials/describe`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: crypto.randomUUID(),
          method: 'credentials/describe',
          payload: { args: { refs: ['DEEPSEEK_API_KEY'] } },
        }),
      })
      await answer.text()
      readyAt = performance.now()
      break
    } catch {
      if (Date.now() > deadline) break
      await new Promise(done => setTimeout(done, 25))
    }
  }
}

try {
  process.kill(-child.pid, 'SIGKILL')
} catch {
  try {
    child.kill('SIGKILL')
  } catch {}
}
await profile.dispose()

if (process.env.DUMP_HOST === '1') console.log(`--- host output ---\n${output.slice(-4000)}`)
console.log(
  JSON.stringify({
    side: workspace.split('/').at(-1),
    bundles: bundles.length,
    prepareMs,
    spawnToFirstOutputMs: firstOutputAt === null ? null : Math.round(firstOutputAt - spawnAt),
    spawnToUrlMs: urlAt === null ? null : Math.round(urlAt - spawnAt),
    spawnToReadyMs: readyAt === null ? null : Math.round(readyAt - spawnAt),
    announced: launchUrl !== undefined,
  }),
)
