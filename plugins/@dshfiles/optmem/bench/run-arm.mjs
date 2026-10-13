// One benchmark run: one arm × one scenario × one repetition, in a fresh scratch DSH home.
// Usage: node run-arm.mjs --arm A|B|C --scenario scenarios/<name>.json --port 3221 --out <results-dir> [--rep 1]
// Arms: A = native compaction only (OptMem not loaded), B = OptMem compatibility, C = OptMem full (+ request-messages),
//       M = @dshfiles/memory (digests of idle threads, a frozen start block, memory tools; OptMem not loaded).
// A key exported under the account's apiKeyEnv (secret run) is used instead of the DSH credentials file.
// Env: BENCH_PROVIDER (default opencode-go-alex), BENCH_MODEL (default deepseek-v4.1-flash), BENCH_EFFORT (default: adapter default),
//      BENCH_ACCOUNTS (default ~/.dsh/plugins/ai-accounts/accounts.json), BENCH_CREDENTIALS (default ~/.dsh/.credentials.yaml),
//      BENCH_HOME_ROOT (default /private/tmp/claude-501/optmem-bench-homes), BENCH_KEEP_HOME=1 keeps the home (credentials are always removed).
// The API key is copied into the scratch home's own credentials file (mode 600) and never printed, logged or passed on a command line.
import { spawn, spawnSync } from 'node:child_process'
import { appendFile, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { calibrationVariants } from './calibration-cases.mjs'
import { generateFixture } from './fixtures.mjs'
import { fillTruth, scoreProbe } from './probes.mjs'
import { loadScenario, runtimeFingerprint } from './scenario-loader.mjs'

const benchRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(benchRoot, '../../../..')
const { values: args } = parseArgs({
  options: {
    arm: { type: 'string' },
    scenario: { type: 'string' },
    port: { type: 'string' },
    out: { type: 'string' },
    rep: { type: 'string', default: '1' },
    variant: { type: 'string', default: 'long' },
    'drain-ms': { type: 'string', default: '120000' },
    calibration: { type: 'boolean', default: false },
    'calibration-variants': { type: 'string', default: 'baseline-default,low-effort' },
    'calibration-limit': { type: 'string', default: '2' },
    'calibration-reps': { type: 'string', default: '1' },
  },
})
if (!['A', 'B', 'C', 'M'].includes(args.arm ?? '') || args.scenario === undefined || args.port === undefined || args.out === undefined)
  throw new Error('usage: run-arm.mjs --arm A|B|C|M --scenario <file> --port <port> --out <dir> [--rep n]')
if (args.calibration && args.arm !== 'A') throw new Error('direct calibration uses arm A without a live memory engine')
const calibrationSettings = z
  .object({
    variants: z
      .string()
      .transform(value => value.split(',').map(id => id.trim()))
      .pipe(
        z
          .array(z.string().min(1))
          .min(1)
          .max(10)
          .refine(values => new Set(values).size === values.length),
      ),
    limit: z.coerce.number().int().min(1).max(50),
    repetitions: z.coerce.number().int().min(1).max(10),
  })
  .parse({
    variants: args['calibration-variants'],
    limit: args['calibration-limit'],
    repetitions: args['calibration-reps'],
  })
const arm = args.arm
const { scenario, scenarioHash, sourceHash, scenarioPath } = await loadScenario({ path: args.scenario, rep: Number(args.rep), variant: args.variant })
const provider = process.env.BENCH_PROVIDER ?? 'opencode-go-alex'
const model = process.env.BENCH_MODEL ?? 'deepseek-v4.1-flash'
const effort = process.env.BENCH_EFFORT ?? ''
const summaryEffort = process.env.BENCH_SUMMARY_EFFORT ?? ''
if (!['', 'off', 'low', 'medium', 'high'].includes(summaryEffort)) throw new Error('unsupported BENCH_SUMMARY_EFFORT')
// An explicit summary route overrides OptMem's cheap-model routing; the effort alone keeps the agent's account and model.
const summaryProvider = process.env.BENCH_SUMMARY_PROVIDER ?? (summaryEffort === '' ? '' : provider)
const summaryModel = process.env.BENCH_SUMMARY_MODEL ?? (summaryProvider === '' ? '' : model)
if ((summaryProvider === '') !== (summaryModel === '')) throw new Error('BENCH_SUMMARY_PROVIDER and BENCH_SUMMARY_MODEL go together')
const calibrationRoutes = args.calibration
  ? calibrationSettings.variants.flatMap(id => calibrationVariants.find(variant => variant.id === id)?.provider ?? [])
  : []
const accountIds = [...new Set([provider, ...(summaryProvider === '' ? [] : [summaryProvider]), ...calibrationRoutes])]
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
const withOptmem = arm === 'B' || arm === 'C'
const withMemory = arm === 'M'
const withRequestMessages = arm === 'C'
const extraDependencies = {
  '@dshfiles/shared-runtime': plugin('shared-runtime'),
  '@dshfiles/ai-accounts': plugin('ai-accounts'),
  '@dshfiles/optmem-bench-probe': `link:${resolve(benchRoot, 'probe')}`,
}
if (withRequestMessages) extraDependencies['@dshfiles/request-messages'] = plugin('request-messages')
if (withOptmem) extraDependencies['@dshfiles/optmem'] = plugin('optmem')
if (withMemory) extraDependencies['@dshfiles/memory'] = plugin('memory')
const scratch = await createScratchProfile({
  profileName: 'optmem-bench',
  // Only the shape is read; every @dshfiles / third-party dependency is excluded below. The checked-in seed keeps the
  // run independent of the live ~/.dsh.
  sourceProfileRoot: process.env.BENCH_SOURCE_PROFILE ?? resolve(repoRoot, 'profiles/web'),
  bundleIds: [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    '@dshfiles/shared-runtime',
    '@dshfiles/ai-accounts',
    '@dshfiles/optmem-bench-probe',
    ...(withRequestMessages ? ['@dshfiles/request-messages'] : []),
    ...(withOptmem ? ['@dshfiles/optmem'] : []),
    ...(withMemory ? ['@dshfiles/memory'] : []),
  ],
  excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket', 'dsh-our-free-model'],
  extraDependencies,
})
const home = scratch.home
const credentialsFile = resolve(home, '.credentials.yaml')
const codexHomes = []
let child
log('scratch home', home)

try {
  const probeFile = resolve(outDir, `${runId}.calls.jsonl`)
  const previousEvidence = await readFile(resolve(outDir, `${runId}.json`), 'utf8').catch(() => undefined)
  if (previousEvidence !== undefined) {
    const archive = resolve(outDir, 'attempts', `${runId}-${Date.now()}`)
    await mkdir(archive, { recursive: true, mode: 0o700 })
    for (const suffix of ['.json', '.calls.jsonl', '.calibration.jsonl', '.host.log', '.scenario.json', '.optmem']) {
      await cp(resolve(outDir, `${runId}${suffix}`), resolve(archive, `${runId}${suffix}`), { recursive: true }).catch(error => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }
  if (probeFile !== resolve(outDir, `${runId}.calls.jsonl`)) throw new Error('unexpected benchmark probe path')
  await rm(probeFile, { force: true })
  if (args.calibration) await rm(resolve(outDir, `${runId}.calibration.jsonl`), { force: true })
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
${args.calibration ? `    calibration: true\n    calibrationVariants: ${JSON.stringify(calibrationSettings.variants)}\n    calibrationLimit: ${calibrationSettings.limit}\n    calibrationReps: ${calibrationSettings.repetitions}\n` : ''}${withOptmem ? `- id: dshfiles-optmem\n  config:\n    mode: ${arm === 'C' ? 'full' : 'compat'}\n${summaryProvider === '' ? '' : `    summarizerProvider: ${summaryProvider}\n    summarizerModel: ${summaryModel}\n`}${summaryEffort === '' ? '' : `    summarizerEffort: ${summaryEffort}\n`}` : ''}`,
  )

  const project = resolve(home, 'project')
  let truth
  try {
    // Account + its one credential, nothing else. The YAML is parsed in-process; values are never echoed.
    const { parse: parseYaml, stringify: stringifyYaml } = await import(
      pathToFileURL(resolve(repoRoot, 'plugins/@dshfiles/ai-accounts/node_modules/yaml/dist/index.js')).href
    )
    const accounts = JSON.parse(await readFile(process.env.BENCH_ACCOUNTS ?? resolve(homedir(), '.dsh/plugins/ai-accounts/accounts.json'), 'utf8'))
    // A key exported under the account's apiKeyEnv (e.g. through `secret run`) wins; the DSH credentials file is read only otherwise.
    const keysFromEnvironment = accountIds.every(id => {
      const account = accounts.accounts.find(entry => entry.instanceId === id)
      return account !== undefined && account.kind !== 'codex' && (process.env[account.apiKeyEnv] ?? '') !== ''
    })
    const sourceCredentials = keysFromEnvironment
      ? { refs: {} }
      : parseYaml(await readFile(process.env.BENCH_CREDENTIALS ?? resolve(homedir(), '.dsh/.credentials.yaml'), 'utf8'))
    const refs = {}
    const copied = []
    for (const id of accountIds) {
      const account = accounts.accounts.find(entry => entry.instanceId === id)
      if (account === undefined) throw new Error(`account ${id} is not configured in AI Accounts`)
      if (account.kind === 'codex') {
        // Codex homes must sit inside the OS user's home, so the copied login lives in a private directory there.
        // Only auth.json is copied; the access token outlives a run, so nothing refreshes (or rotates) the copy.
        const source = resolve((account.shadowHomePath ?? '') === '' ? account.homePath : account.shadowHomePath, 'auth.json')
        await mkdir(resolve(userInfo().homedir, '.cache'), { recursive: true, mode: 0o700 })
        const codexHome = await mkdtemp(resolve(userInfo().homedir, '.cache', 'optmem-bench-codex-'))
        codexHomes.push(codexHome)
        // An empty shadow path would default under the scratch home, outside the user's home, so both are explicit.
        const shared = resolve(codexHome, 'home')
        const shadow = resolve(codexHome, 'shadow')
        await mkdir(shared, { mode: 0o700 })
        await mkdir(shadow, { mode: 0o700 })
        await cp(source, resolve(shadow, 'auth.json'))
        await chmod(resolve(shadow, 'auth.json'), 0o600)
        copied.push({ ...account, homePath: shared, shadowHomePath: shadow })
        continue
      }
      const keyName = account.apiKeyEnv
      const credentialReference = z
        .string()
        .min(1)
        .safeParse(process.env[keyName] || sourceCredentials?.refs?.[keyName])
      if (!credentialReference.success) throw new Error(`credential ${keyName} is not stored in DSH credentials`)
      refs[keyName] = credentialReference.data
      copied.push(account)
    }
    await mkdir(resolve(home, 'plugins/ai-accounts'), { recursive: true, mode: 0o700 })
    await writeFile(
      resolve(home, 'plugins/ai-accounts/accounts.json'),
      JSON.stringify(
        { distribution: accounts.distribution, cooldownMs: accounts.cooldownMs, shadowRoot: resolve(home, 'codex-shadow'), accounts: copied },
        null,
        2,
      ),
      { mode: 0o600 },
    )
    await writeFile(credentialsFile, stringifyYaml({ version: 1, records: {}, refs }), { mode: 0o600 })
    await chmod(credentialsFile, 0o600)

    await mkdir(project, { recursive: true })
    truth = { ...(await generateFixture(scenario.fixture, project)), ...scenario.truth }
    const initialized = spawnSync('jj', ['git', 'init', '--colocate'], { cwd: project, encoding: 'utf8' })
    if (initialized.status !== 0) throw new Error(`scratch jj initialization failed: ${initialized.stderr}`)
    const described = spawnSync('jj', ['describe', '-m', 'chore(bench): initialize isolated fixture'], { cwd: project, encoding: 'utf8' })
    if (described.status !== 0) throw new Error(`scratch jj description failed: ${described.stderr}`)

    await scratch.install()
  } catch (error) {
    if (credentialsFile !== resolve(scratch.home, '.credentials.yaml')) throw new Error('unexpected scratch credential path')
    await rm(credentialsFile, { force: true })
    for (const codexHome of codexHomes) await rm(codexHome, { recursive: true, force: true })
    await scratch.cleanup()
    throw error
  }
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
  child = spawn('dsh', ['optmem-bench', ...patches, '--port', args.port, '--no-open'], {
    cwd: project,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const collect = chunk => (output = `${output}${chunk.toString('utf8')}`.slice(-2_000_000))
  let spawnError
  child.on('error', error => {
    spawnError = error
  })
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const urlPattern = /http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/

  const fill = text => fillTruth(text, truth)
  const evidence = {
    runId,
    scenario: scenario.name,
    arm,
    rep: Number(args.rep),
    provider,
    model,
    effort,
    summaryEffort,
    summaryProvider,
    summaryModel,
    variant: args.variant,
    scenarioHash,
    sourceHash,
    scenarioPath,
    metadata: scenario.metadata,
    runtimeHash: await runtimeFingerprint({ arm, calibration: args.calibration }),
    calibration: args.calibration
      ? { variants: calibrationSettings.variants, limit: calibrationSettings.limit, repetitions: calibrationSettings.repetitions }
      : undefined,
    compaction: scenario.compaction ?? 'stock',
    expectedTurns: scenario.conversations.reduce((total, conversation) => total + conversation.turns.length, 0),
    startedAt: new Date().toISOString(),
    turns: [],
  }
  await writeFile(resolve(outDir, `${runId}.scenario.json`), JSON.stringify(scenario, null, 2), { mode: 0o600 })

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

  let finishing = false
  const finish = async code => {
    if (finishing) return
    finishing = true
    await stopHost()
    await rm(credentialsFile, { force: true })
    for (const codexHome of codexHomes) await rm(codexHome, { recursive: true, force: true })
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
    if (withMemory) {
      await cp(resolve(home, 'plugins/memory'), resolve(outDir, `${runId}.memory`), { recursive: true }).catch(() => {})
      evidence.memoryDb = await memoryStats().catch(error => ({ error: String(error) }))
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
    try {
      return {
        events: all('select count(*) n from events')[0].n,
        nodes: all('select count(*) n from nodes')[0].n,
        pendingLeaves: all(
          'select count(*) n from stream_entries e left join nodes n on n.stream = e.stream and n.level = 0 and n.idx = e.pos where n.idx is null',
        )[0].n,
        pendingViews: all(
          "select count(*) n from (select stream, count(*) length from stream_entries group by stream) s cross join (select 'main' kind union all select 'compact') k left join views v on v.stream = s.stream and v.kind = k.kind where v.stream is null or v.through_pos != s.length or v.merge_pending != 0",
        )[0].n,
        pendingParents: all(
          'select count(*) n from nodes a join nodes b on b.stream = a.stream and b.level = a.level and b.idx = a.idx + 1 left join nodes p on p.stream = a.stream and p.level = a.level + 1 and p.idx = a.idx / 2 where a.idx % 2 = 0 and p.idx is null',
        )[0].n,
        nodesByModel: all('select model, count(*) n from nodes group by model order by n desc'),
        views: all('select stream, kind, through_pos, bytes, version from views'),
      }
    } finally {
      db.close()
    }
  }

  const memoryStats = async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(resolve(home, 'plugins/memory/memory.db'), { readOnly: true })
    const all = sql => db.prepare(sql).all()
    try {
      return {
        threads: all('select id, source, length(digest) bytes, duplicate_of is not null duplicate from threads'),
        notes: all('select count(*) n from notes where valid = 1')[0].n,
        messages: all('select count(*) n from messages')[0].n,
        blocks: all('select thread, length(text) bytes from thread_blocks'),
        toolCalls: all('select tool, count(*) calls, sum(results > 0) withResults, sum(used) used from tool_calls group by tool'),
        counters: all('select name, value from counters'),
      }
    } finally {
      db.close()
    }
  }

  /** A real user leaves time between threads; the harness waits until the previous thread's digest exists instead. */
  const waitForDigest = async sessionId => {
    const started = Date.now()
    const { DatabaseSync } = await import('node:sqlite')
    let seenAt
    while (Date.now() - started < 240_000) {
      const db = new DatabaseSync(resolve(home, 'plugins/memory/memory.db'), { readOnly: true })
      try {
        const row = db.prepare('select source from threads where id = ?').get(sessionId)
        const seen = db.prepare('select through_seq from indexed_threads where thread = ?').get(sessionId)
        if (row !== undefined) return { sessionId, waitedMs: Date.now() - started, digest: row.source }
        // Indexed but no digest yet: a trivial thread, or a model digest still in flight; give the call time to land.
        seenAt = seen === undefined ? undefined : (seenAt ?? Date.now())
        if (seenAt !== undefined && Date.now() - seenAt > 20_000) return { sessionId, waitedMs: Date.now() - started, digest: 'none (trivial)' }
      } catch {
        // The database appears with the first digest.
      } finally {
        db.close()
      }
      await new Promise(done => setTimeout(done, 1000))
    }
    return { sessionId, waitedMs: Date.now() - started, digest: 'timeout' }
  }

  const drainSummaries = async () => {
    if (!withOptmem) return
    const started = Date.now()
    const database = resolve(home, 'plugins/optmem/optmem.db')
    let stableSince = Date.now()
    let previous = ''
    while (Date.now() - started < Number(args['drain-ms'])) {
      const state = await optmemStats(database)
      const signature = JSON.stringify(state)
      if (signature !== previous) stableSince = Date.now()
      previous = signature
      const complete = state.pendingLeaves === 0 && state.pendingViews === 0 && state.pendingParents === 0 && Date.now() - stableSince >= 5000
      evidence.drain = {
        complete,
        elapsedMs: Date.now() - started,
        pendingLeaves: state.pendingLeaves,
        pendingViews: state.pendingViews,
        pendingParents: state.pendingParents,
      }
      if (complete) return
      if (child.exitCode !== null) throw new Error('host exited while draining summaries')
      await new Promise(done => setTimeout(done, 1000))
    }
    log('summary drain deadline', JSON.stringify(evidence.drain))
  }

  const textOf = event =>
    (event.data?.message?.content ?? [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')

  try {
    const started = Date.now()
    while (!urlPattern.test(output)) {
      if (spawnError !== undefined || Date.now() - started > 120_000 || child.exitCode !== null)
        throw new Error(`host not ready\n${redactHostOutput(output.slice(-4000))}`)
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
            failure:
              ended.data.reason?.failure === undefined
                ? undefined
                : {
                    code: ended.data.reason.failure.code,
                    status: ended.data.reason.failure.status,
                    message: redactHostOutput(ended.data.reason.failure.message ?? '').slice(0, 500),
                  },
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
            answer: answer.slice(0, 100000),
            answerTruncated: answer.length > 100000,
          }
          if (item.packet !== undefined) {
            record.packet = {
              topic: item.packet.topic,
              stage: item.packet.stage,
              rows: item.packet.rows,
              requiresTools: item.packet.requiresTools,
            }
          }
          if (item.probe !== undefined) {
            record.probe = scoreProbe({
              answer,
              probe: item.probe,
              truth,
              tools: assistant.flatMap(event =>
                (event.data.message?.content ?? []).filter(block => block.type === 'tool-call').map(block => block.name ?? block.toolName),
              ),
            })
          }
          evidence.turns.push(record)
          log(
            `${conversation} t${record.turn}`,
            `${(record.wallMs / 1000).toFixed(1)}s`,
            `steps=${record.steps.length}`,
            `in=${record.steps.reduce((sum, step) => sum + (step.usage?.inputTokens ?? 0) + (step.usage?.cacheReadTokens ?? 0), 0)}`,
            record.probe === undefined ? '' : `probe ${record.probe.id}=${record.probe.pass ? 'PASS' : `FAIL(${record.probe.missing.join('|')})`}`,
          )
          if (record.end !== 'completed') throw new Error(`turn ${turnNumber} ended with ${record.end}`)
          return record
        }
        if (child.exitCode !== null) throw new Error('host exited during a turn')
        await new Promise(done => setTimeout(done, 750))
      }
      throw new Error(`turn timed out: ${prompt.slice(0, 120)}`)
    }

    let previousSession
    for (const conversation of scenario.conversations) {
      if (withMemory && previousSession !== undefined) {
        const waited = await waitForDigest(previousSession)
        evidence.memoryWaits = [...(evidence.memoryWaits ?? []), waited]
        log('memory digest', JSON.stringify(waited))
      }
      const created = await platform.sessions.create({ cwd: project })
      previousSession = created.sessionId
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
        signal: acceptance.signal,
        error: acceptance.error?.message,
        valid: acceptance.status === 0 && /# pass [1-9]\d*/.test(summary),
        pass: Number(/# pass (\d+)/.exec(summary)?.[1] ?? 0),
        fail: Number(/# fail (\d+)/.exec(summary)?.[1] ?? 0),
        failed: [...summary.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]).slice(0, 20),
      }
      log('acceptance', JSON.stringify(evidence.acceptance))
    }
    if (withMemory && previousSession !== undefined) {
      const waited = await waitForDigest(previousSession)
      evidence.memoryWaits = [...(evidence.memoryWaits ?? []), waited]
    }
    await drainSummaries()
    await finish(evidence.drain?.complete === false ? 2 : 0)
  } catch (error) {
    evidence.error = String(error?.stack ?? error).slice(0, 4000)
    log(evidence.error)
    await appendFile(resolve(outDir, 'errors.log'), `${runId}: ${evidence.error}\n`)
    await finish(1)
  }
} catch (error) {
  if (child?.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {}
  }
  if (credentialsFile !== resolve(scratch.home, '.credentials.yaml')) throw new Error('unexpected scratch credential path')
  await rm(credentialsFile, { force: true })
  for (const codexHome of codexHomes) await rm(codexHome, { recursive: true, force: true })
  await scratch.cleanup()
  const failure = {
    runId,
    scenario: scenario.name,
    arm,
    rep: Number(args.rep),
    provider,
    model,
    effort,
    summaryEffort,
    summaryProvider,
    summaryModel,
    variant: args.variant,
    scenarioHash,
    sourceHash,
    expectedTurns: scenario.conversations.reduce((sum, conversation) => sum + conversation.turns.length, 0),
    turns: [],
    error: `benchmark setup failed (${error instanceof Error ? error.name : 'unknown error'})`,
    finishedAt: new Date().toISOString(),
  }
  await writeFile(resolve(outDir, `${runId}.json`), JSON.stringify(failure, null, 2))
  console.error(failure.error)
  process.exitCode = 1
}
