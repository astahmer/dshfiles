// One benchmark run: one arm × one scenario × one repetition, in a fresh scratch DSH home.
// Usage: node run-arm.mjs --arm A|B|C --scenario scenarios/<name>.json --port 3221 --out <results-dir> [--rep 1]
// Arms: A = native compaction only (OptMem not loaded), B = OptMem compatibility, C = OptMem full (+ request-messages).
// Env: BENCH_PROVIDER (default opencode-go-alex), BENCH_MODEL (default deepseek-v4.1-flash), BENCH_EFFORT (default: adapter default),
//      BENCH_ACCOUNTS (default ~/.dsh/plugins/ai-accounts/accounts.json), BENCH_CREDENTIALS (default ~/.dsh/.credentials.yaml),
//      BENCH_HOME_ROOT (default /private/tmp/claude-501/optmem-bench-homes), BENCH_KEEP_HOME=1 keeps the home (credentials are always removed).
// The API key is copied into the scratch home's own credentials file (mode 600) and never printed, logged or passed on a command line.
import { spawn, spawnSync } from 'node:child_process'
import { appendFile, chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { generateFixture } from './fixtures.mjs'
import { fillTruth, scoreProbe } from './probes.mjs'

const benchRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(benchRoot, '../../../..')
const { values: args } = parseArgs({
  options: {
    arm: { type: 'string' },
    scenario: { type: 'string' },
    port: { type: 'string' },
    out: { type: 'string' },
    rep: { type: 'string', default: '1' },
  },
})
if (!['A', 'B', 'C'].includes(args.arm ?? '') || args.scenario === undefined || args.port === undefined || args.out === undefined)
  throw new Error('usage: run-arm.mjs --arm A|B|C --scenario <file> --port <port> --out <dir> [--rep n]')
const arm = args.arm
const scenario = JSON.parse(await readFile(resolve(args.scenario), 'utf8'))
const provider = process.env.BENCH_PROVIDER ?? 'opencode-go-alex'
const model = process.env.BENCH_MODEL ?? 'deepseek-v4.1-flash'
const effort = process.env.BENCH_EFFORT ?? ''
const runId = `${scenario.name}-${arm}-r${args.rep}`
const outDir = resolve(args.out)
await mkdir(outDir, { recursive: true })
const log = (...parts) => process.stdout.write(`[${runId}] ${parts.join(' ')}\n`)

// createScratchProfile places homes under os.tmpdir(), which follows TMPDIR.
const homeRoot = process.env.BENCH_HOME_ROOT ?? '/private/tmp/claude-501/optmem-bench-homes'
await mkdir(homeRoot, { recursive: true, mode: 0o700 })
process.env.TMPDIR = homeRoot
const { createScratchProfile, isolatedHostEnvironment, redactHostOutput } = await import(
  pathToFileURL(resolve(repoRoot, 'tooling/dshx/packages/dshx/dist/project/scratch-profile.js')).href
)
const { connectDshPlatformClient } = await import(pathToFileURL(resolve(repoRoot, 'tooling/dshx/packages/dshx/dist/platform/index.js')).href)
const plugin = name => `link:${resolve(repoRoot, 'plugins/@dshfiles', name)}`
const withOptmem = arm !== 'A'
const withRequestMessages = arm === 'C'
const scratch = await createScratchProfile({
  profileName: 'optmem-bench',
  // Only the shape is read; every @dshfiles / third-party dependency is excluded below.
  sourceProfileRoot: resolve(homedir(), '.dsh/profiles/probe'),
  bundleIds: [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    '@dshfiles/shared-runtime',
    '@dshfiles/ai-accounts',
    '@dshfiles/optmem-bench-probe',
    ...(withRequestMessages ? ['@dshfiles/request-messages'] : []),
    ...(withOptmem ? ['@dshfiles/optmem'] : []),
  ],
  excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket', 'dsh-our-free-model'],
  extraDependencies: {
    '@dshfiles/shared-runtime': plugin('shared-runtime'),
    '@dshfiles/ai-accounts': plugin('ai-accounts'),
    '@dshfiles/optmem-bench-probe': `link:${resolve(benchRoot, 'probe')}`,
    ...(withRequestMessages ? { '@dshfiles/request-messages': plugin('request-messages') } : {}),
    ...(withOptmem ? { '@dshfiles/optmem': plugin('optmem') } : {}),
  },
})
const home = scratch.home
const credentialsFile = resolve(home, '.credentials.yaml')
log('scratch home', home)

const probeFile = resolve(outDir, `${runId}.calls.jsonl`)
await rm(probeFile, { force: true })
const overlay = resolve(home, 'bench.patch.yml')
await writeFile(
  overlay,
  `- id: connection
  inject:
    - webRuntime
    - webServer
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: ${provider}
    model: ${model}
${effort === '' ? '' : `    reasoningEffort: ${effort}\n`}- id: dshfiles-optmem-bench-probe
  config:
    file: ${JSON.stringify(probeFile)}
${withOptmem ? `- id: dshfiles-optmem\n  config:\n    mode: ${arm === 'C' ? 'full' : 'compat'}\n` : ''}`,
)

// Account + its one credential, nothing else. The YAML is parsed in-process; values are never echoed.
const { parse: parseYaml, stringify: stringifyYaml } = await import(
  pathToFileURL(resolve(repoRoot, 'plugins/@dshfiles/ai-accounts/node_modules/yaml/dist/index.js')).href
)
const accounts = JSON.parse(await readFile(process.env.BENCH_ACCOUNTS ?? resolve(homedir(), '.dsh/plugins/ai-accounts/accounts.json'), 'utf8'))
const account = accounts.accounts.find(entry => entry.instanceId === provider)
if (account === undefined) throw new Error(`account ${provider} is not configured in AI Accounts`)
await mkdir(resolve(home, 'plugins/ai-accounts'), { recursive: true, mode: 0o700 })
await writeFile(
  resolve(home, 'plugins/ai-accounts/accounts.json'),
  JSON.stringify(
    { distribution: accounts.distribution, cooldownMs: accounts.cooldownMs, shadowRoot: resolve(home, 'codex-shadow'), accounts: [account] },
    null,
    2,
  ),
  { mode: 0o600 },
)
const sourceCredentials = parseYaml(await readFile(process.env.BENCH_CREDENTIALS ?? resolve(homedir(), '.dsh/.credentials.yaml'), 'utf8'))
const keyName = account.apiKeyEnv
if (typeof sourceCredentials?.refs?.[keyName] !== 'string') throw new Error(`credential ${keyName} is not stored in DSH credentials`)
await writeFile(credentialsFile, stringifyYaml({ version: 1, records: {}, refs: { [keyName]: sourceCredentials.refs[keyName] } }), { mode: 0o600 })
await chmod(credentialsFile, 0o600)

const project = resolve(home, 'project')
await mkdir(project, { recursive: true })
const truth = await generateFixture(scenario.fixture, project)
const git = (...gitArgs) =>
  spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', '-c', 'commit.gpgsign=false', ...gitArgs], { cwd: project })
git('init', '-q')
git('add', '-A')
git('commit', '-q', '-m', 'initial import')

await scratch.install()
log('installed', `arm ${arm}`, `${provider}/${model}`)

const environment = { ...isolatedHostEnvironment(home, scratch.profileRoot), DSH_PERMISSION_MODE: scenario.permissionMode ?? 'workspace-write' }

// The web app mounts compaction-basic inside each agent preset, and a patch replaces a row's whole config, so the
// compaction policy is applied by restating the default preset row from the composed tree with the policy added.
const patches = ['--patch', overlay]
if (scenario.compaction !== undefined) {
  const dump = spawnSync('dsh', ['optmem-bench', ...patches, '--dump-config'], {
    cwd: project,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const lines = dump.stdout.split('\n')
  const start = lines.indexOf('- id: preset-standard')
  const end = lines.findIndex((line, index) => index > start && line.startsWith('- id: '))
  const row = lines.slice(start, end === -1 ? undefined : end).filter(line => !line.startsWith('#'))
  const anchor = row.findIndex(line => line.trim() === "name: '@deepseek-ai/dsh-compaction-basic'")
  if (start === -1 || anchor === -1 || row[anchor + 1]?.trim() === 'config:')
    throw new Error('could not locate the preset-standard compaction-basic row in the composed tree')
  const indent = row[anchor].slice(0, row[anchor].indexOf('name:'))
  row.splice(anchor + 1, 0, `${indent}config:`, ...Object.entries(scenario.compaction).map(([key, value]) => `${indent}  ${key}: ${value}`))
  const compactionOverlay = resolve(home, 'bench-compaction.patch.yml')
  await writeFile(compactionOverlay, `${row.join('\n')}\n`)
  patches.push('--patch', compactionOverlay)
}
let output = ''
const child = spawn('dsh', ['optmem-bench', ...patches, '--port', args.port, '--no-open'], {
  cwd: project,
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
})
const collect = chunk => (output = `${output}${chunk.toString('utf8')}`.slice(-2_000_000))
child.stdout.on('data', collect)
child.stderr.on('data', collect)
const urlPattern = /http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/

const fill = text => fillTruth(text, truth)
const evidence = { runId, scenario: scenario.name, arm, rep: Number(args.rep), provider, model, startedAt: new Date().toISOString(), turns: [] }

const stopHost = async () => {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {}
  await new Promise(done => setTimeout(done, 1500))
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {}
}

for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    evidence.error = `interrupted by ${signal}`
    void finish(130)
  })

const finish = async code => {
  await stopHost()
  await rm(credentialsFile, { force: true })
  evidence.finishedAt = new Date().toISOString()
  evidence.hostWarnings = redactHostOutput(output)
    .split('\n')
    .filter(line => /did not activate|failed to import|unhandled|compaction-basic|request-messages is unavailable|ai-accounts: skipped/i.test(line))
    .slice(-60)
  if (withOptmem) {
    const database = resolve(home, 'plugins/optmem/optmem.db')
    await cp(resolve(home, 'plugins/optmem'), resolve(outDir, `${runId}.optmem`), { recursive: true }).catch(() => {})
    evidence.optmemDb = await optmemStats(database).catch(error => ({ error: String(error) }))
  }
  await writeFile(resolve(outDir, `${runId}.json`), JSON.stringify(evidence, null, 2))
  await writeFile(resolve(outDir, `${runId}.host.log`), redactHostOutput(output), { mode: 0o600 })
  if (process.env.BENCH_KEEP_HOME !== '1') await scratch.cleanup()
  process.exit(code)
}

const optmemStats = async database => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(database, { readOnly: true })
  const all = sql => db.prepare(sql).all()
  return {
    events: all('select count(*) n from events')[0].n,
    nodesByModel: all('select model, count(*) n from nodes group by model order by n desc'),
    views: all('select stream, kind, through_pos, bytes, version from views'),
  }
}

const textOf = event =>
  (event.data?.message?.content ?? [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')

try {
  const started = Date.now()
  while (!urlPattern.test(output)) {
    if (Date.now() - started > 120_000 || child.exitCode !== null) throw new Error(`host not ready\n${redactHostOutput(output.slice(-4000))}`)
    await new Promise(done => setTimeout(done, 250))
  }
  await new Promise(done => setTimeout(done, 1500))
  const platform = await connectDshPlatformClient({ url: output.match(urlPattern)[0] })
  // history() returns only the latest page, so turn ends are matched by turn number and a finished turn is read from the
  // full export.
  const latestEvents = async id => (await platform.sessions.history(id, 40)).records.map(record => record.event ?? record)
  const allEvents = async id => (await platform.sessions.export(id)).map(record => record.event ?? record)
  const completedTurns = new Map()

  const turn = async (conversation, id, item) => {
    const prompt = fill(item.prompt)
    const before = completedTurns.get(id) ?? 0
    const logStart = output.length
    const turnStarted = Date.now()
    await platform.sessions.prompt(id, prompt, 'queue')
    const expires = Date.now() + (scenario.turnTimeoutMs ?? 600_000)
    while (Date.now() < expires) {
      const ended = (await latestEvents(id)).findLast(event => event.type === 'turn/end' && event.data.turn > before)
      if (ended !== undefined) {
        const turnNumber = ended.data.turn
        completedTurns.set(id, turnNumber)
        const all = await allEvents(id)
        const mine = all.filter(event => event.data?.turn === turnNumber)
        const assistant = mine.filter(event => event.type === 'assistant/message')
        const answer = assistant.map(textOf).join('\n')
        const record = {
          conversation,
          session: id,
          turn: turnNumber,
          promptBytes: Buffer.byteLength(prompt),
          wallMs: Date.now() - turnStarted,
          end: ended.data.reason?.kind ?? ended.data.reason,
          steps: assistant.map(event => ({
            usage: event.data.usage,
            tools: (event.data.message?.content ?? []).filter(block => block.type === 'tool-call').map(block => block.name ?? block.toolName),
          })),
          compactionEvents: all.filter(event => event.type.startsWith('compaction/') && (event.data?.turn === undefined || event.data.turn === turnNumber))
            .length,
          fullModeRequests: output
            .slice(logStart)
            .split('\n')
            .filter(line => line.includes('optmem: full-mode request {'))
            .map(line => JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1)))
            .filter(request => request.conversationId === id && request.turn === turnNumber)
            .map(request => ({
              originalCount: request.originalCount,
              sentCount: request.sentCount,
              sentBytes: request.sentBytes,
              viewBytes: request.viewBytes,
            })),
          answer: answer.slice(0, 4000),
          ...(item.probe === undefined ? {} : { probe: scoreProbe({ answer, probe: item.probe, truth }) }),
        }
        evidence.turns.push(record)
        log(
          `${conversation} t${record.turn}`,
          `${(record.wallMs / 1000).toFixed(1)}s`,
          `steps=${record.steps.length}`,
          `in=${record.steps.reduce((sum, step) => sum + (step.usage?.inputTokens ?? 0) + (step.usage?.cacheReadTokens ?? 0), 0)}`,
          record.probe === undefined ? '' : `probe ${record.probe.id}=${record.probe.pass ? 'PASS' : `FAIL(${record.probe.missing.join('|')})`}`,
        )
        return record
      }
      if (child.exitCode !== null) throw new Error('host exited during a turn')
      await new Promise(done => setTimeout(done, 750))
    }
    throw new Error(`turn timed out: ${prompt.slice(0, 120)}`)
  }

  for (const conversation of scenario.conversations) {
    const created = await platform.sessions.create({ cwd: project })
    for (const item of conversation.turns) await turn(conversation.name, created.sessionId, item)
    const history = await allEvents(created.sessionId)
    evidence.sessionEventCounts = {
      ...evidence.sessionEventCounts,
      [conversation.name]: Object.fromEntries(
        [...new Set(history.map(event => event.type))].map(type => [type, history.filter(event => event.type === type).length]),
      ),
    }
  }
  if (scenario.acceptance !== undefined) {
    const acceptance = spawnSync('node', ['--test', '--test-reporter=tap', resolve(benchRoot, scenario.acceptance)], {
      cwd: project,
      env: { PATH: process.env.PATH, BENCH_PROJECT: project },
      encoding: 'utf8',
      timeout: 120_000,
    })
    const summary = `${acceptance.stdout}\n${acceptance.stderr}`
    evidence.acceptance = {
      exitCode: acceptance.status,
      pass: Number(/# pass (\d+)/.exec(summary)?.[1] ?? 0),
      fail: Number(/# fail (\d+)/.exec(summary)?.[1] ?? 0),
      failed: [...summary.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]).slice(0, 20),
    }
    log('acceptance', JSON.stringify(evidence.acceptance))
  }
  await new Promise(done => setTimeout(done, 3000))
  await finish(0)
} catch (error) {
  evidence.error = String(error?.stack ?? error).slice(0, 4000)
  log(evidence.error)
  await appendFile(resolve(outDir, 'errors.log'), `${runId}: ${evidence.error}\n`)
  await finish(1)
}
