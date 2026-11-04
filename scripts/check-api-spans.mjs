#!/usr/bin/env node

/**
 * Live proof for plan 6.3: every dshx API call is exactly one `<api>/<method>` server span, the handler's
 * `Effect.fn` span is its child, and the checked traces hold no orphan span.
 *
 * Boots a scratch DSH (own temp DSH_HOME, free port, headless Chromium) with two read-only plugins, drives
 * distinct read-only API calls over the authenticated launch URL, waits for the OTLP batch to land in that
 * scratch home's traces database, then reads the rows back. The live DSH on 3080 and ~/.dsh are never touched.
 *
 *   node scripts/check-api-spans.mjs [--keep] [--skip-build] [--timeout <ms>]
 *
 * Exit 0 when every assertion holds; 1 on a violation (rows and trace ids printed first), 2 on usage/boot.
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'
import { connectDshxApi } from '../tooling/dshx/packages/dshx/dist/platform/dshx-api.js'
import { scratchDown } from '../tooling/dshx/packages/dshx/dist/scratch/lifecycle.js'
import { ScratchStateRuntime } from '../tooling/dshx/packages/dshx/dist/scratch/state.js'
import { scratchUp } from '../tooling/dshx/packages/dshx/dist/scratch/up.js'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const SERVER_KIND = 2
const SELF_API_IDS = new Set(['traces', 'traces-alerts', 'traces-boards'])

const calls = [
  { packageId: '@dshfiles/activity-timeline', apiId: 'activity-timeline', version: 1, method: 'stats', input: {}, handler: 'activity timeline stats' },
  {
    packageId: '@dshfiles/activity-timeline',
    apiId: 'activity-timeline',
    version: 1,
    method: 'attention',
    input: { limit: 5 },
    handler: 'activity timeline attention',
  },
  { packageId: '@dshfiles/activity-timeline', apiId: 'activity-timeline', version: 1, method: 'page', input: { limit: 5 }, handler: 'activity timeline page' },
]

const loopControl = { packageId: '@dshfiles/traces', apiId: 'traces', version: 1, method: 'stats', input: { windowMinutes: 60 } }

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const readRows = database => {
  if (!existsSync(database)) return []
  let db
  try {
    db = new DatabaseSync(database, { readOnly: true })
    return db
      .prepare('SELECT trace_id, span_id, parent_span_id, name, kind, status_code, service, start_us, end_us, attributes FROM spans ORDER BY start_us')
      .all()
  } finally {
    db?.close()
  }
}

const waitForRows = async ({ database, names, timeoutMs }) => {
  const deadline = Date.now() + timeoutMs
  // The Host batches spans for 5 s before exporting, so give the control call's own batch time to land too.
  await sleep(7_000)
  let rows = readRows(database)
  while (Date.now() < deadline) {
    rows = readRows(database)
    const found = new Set(rows.map(row => row.name))
    if (names.every(name => found.has(name))) break
    await sleep(500)
  }
  await sleep(3_000)
  return readRows(database)
}

const apiIdOf = row => {
  const parsed = JSON.parse(row.attributes)
  return typeof parsed['dshx.api.id'] === 'string' ? parsed['dshx.api.id'] : null
}

const orphanCheck = ({ rows, traceIds }) => {
  const byId = new Map(rows.map(row => [row.span_id, row]))
  return rows.filter(
    row => row.parent_span_id !== null && row.parent_span_id !== '' && !byId.has(row.parent_span_id) && (traceIds === undefined || traceIds.has(row.trace_id)),
  )
}

const evaluate = rows => {
  const violations = []
  const checkedTraces = new Set()
  const results = []
  for (const call of calls) {
    const name = `${call.apiId}/${call.method}`
    const dispatch = rows.filter(row => row.name === name && row.kind === SERVER_KIND)
    if (dispatch.length !== 1) {
      violations.push(`${name}: expected exactly 1 server span, found ${dispatch.length}`)
      results.push({ call: name, dispatch: dispatch.length, handler: 'missing', parent: '-', ok: false })
      continue
    }
    const [span] = dispatch
    checkedTraces.add(span.trace_id)
    const handlers = rows.filter(row => row.name === call.handler && row.trace_id === span.trace_id)
    const parented = handlers.filter(row => row.parent_span_id === span.span_id)
    const chain = [span]
    for (let next = chain[0]; next !== undefined;) {
      const child = rows.find(row => row.trace_id === next.trace_id && row.parent_span_id === next.span_id)
      if (child === undefined) break
      chain.push(child)
      next = child
    }
    const ok = parented.length === 1
    if (handlers.length === 0) violations.push(`${name}: no handler span "${call.handler}" in its trace ${span.trace_id}`)
    else if (!ok)
      violations.push(`${name}: handler span "${call.handler}" is not its child (parent ${handlers[0].parent_span_id ?? 'none'}, dispatch ${span.span_id})`)
    results.push({
      call: name,
      dispatch: dispatch.length,
      handler: handlers.length === 0 ? 'missing' : `${call.handler} (${handlers.length})`,
      parent: parented.length === 1 ? 'child' : 'not-child',
      ok,
      traceId: span.trace_id,
      chain: chain.map(entry => entry.name).join(' > '),
    })
  }

  const orphans = orphanCheck({ rows, traceIds: checkedTraces })
  for (const orphan of orphans)
    violations.push(`orphan span ${orphan.span_id} "${orphan.name}" in trace ${orphan.trace_id}: parent ${orphan.parent_span_id} is not stored`)
  const allOrphans = orphanCheck({ rows })

  const loopSpans = rows.filter(row => {
    const apiId = apiIdOf(row)
    return apiId !== null && SELF_API_IDS.has(apiId)
  })
  if (loopSpans.length > 0) violations.push(`traces→traces loop: ${loopSpans.length} span(s) of the traces API were stored, e.g. "${loopSpans[0].name}"`)

  const sqlSpans = rows.filter(row => /\bsql\b|sqlite|SELECT |INSERT INTO |UPDATE /i.test(row.name))
  if (sqlSpans.length > 0) violations.push(`SQL spans stored: ${sqlSpans.map(row => row.name).join(', ')}`)

  return { results, violations, orphans, allOrphans, loopSpans, sqlSpans, checkedTraces }
}

const main = async () => {
  const { values } = parseArgs({
    options: { keep: { type: 'boolean' }, 'skip-build': { type: 'boolean' }, timeout: { type: 'string' } },
  })
  const timeoutMs = Number(values.timeout ?? 180_000)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    console.error('check-api-spans: --timeout requires a positive integer of milliseconds')
    return 2
  }
  const plugins = ['@dshfiles/activity-timeline', '@dshfiles/traces']
  // `dshx dev up` builds only the named bundles, and @dshfiles/traces imports workspace siblings (usage,
  // thread-sidebar) at build time, so build the dependency closure first on a cold checkout.
  if (values['skip-build'] !== true) {
    const build = spawnSync('pnpm', ['exec', 'turbo', 'run', 'build', ...plugins.map(plugin => `--filter=${plugin}...`)], {
      cwd: repoRoot,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    if (build.status !== 0) {
      console.error('check-api-spans: building the plugin closure failed')
      return 2
    }
  }
  const name = `api-spans-${randomUUID().slice(0, 8)}`
  const scratch = await scratchUp({
    name,
    stateDir: ScratchStateRuntime.resolveStateDir({ name }),
    plugins,
    bundles: [],
    skipBuild: values['skip-build'] === true,
    fakeSecretCli: false,
    idleTimeoutMinutes: 0,
    warnMinutes: 0,
    timeoutMs,
    onProgress: message => console.error(`check-api-spans: ${message}`),
  }).catch(cause => cause)
  if (scratch instanceof Error) {
    console.error(`check-api-spans: scratch boot failed: ${scratch.message}`)
    return 2
  }

  let exitCode = 0
  try {
    const connected = new Map()
    const callerOf = async call => {
      const key = `${call.packageId}\0${call.apiId}`
      const cached = connected.get(key)
      if (cached !== undefined) return cached
      const caller = await connectDshxApi({ url: scratch.state.launchUrl, packageId: call.packageId, apiId: call.apiId, version: call.version })
      connected.set(key, caller)
      return caller
    }

    for (const call of calls) {
      const caller = await callerOf(call)
      await caller(call.method, call.input)
    }
    const controlCaller = await callerOf(loopControl)
    await controlCaller(loopControl.method, loopControl.input)

    const database = join(scratch.state.home, 'plugins', 'traces', 'traces.db')
    const names = calls.map(call => `${call.apiId}/${call.method}`)
    const rows = await waitForRows({ database, names, timeoutMs: 45_000 })
    const outcome = evaluate(rows)
    const checked = [...outcome.checkedTraces]
    const controlStored = rows.filter(row => row.name === `${loopControl.apiId}/${loopControl.method}`).length

    console.log(`check-api-spans: scratch home ${scratch.state.home}`)
    console.log(`check-api-spans: database ${database}`)
    console.log('')
    console.log('call                        dispatch  kind  handler                              parent     ok')
    for (const row of outcome.results) {
      const kind = row.dispatch === 1 ? 'server' : '-'
      console.log(
        `${row.call.padEnd(27)} ${String(row.dispatch).padEnd(9)} ${kind.padEnd(5)} ${row.handler.padEnd(36)} ${row.parent.padEnd(10)} ${row.ok ? 'yes' : 'NO'}`,
      )
      if (row.chain !== undefined) console.log(`  chain ${row.chain}`)
    }
    console.log('')
    console.log(`checked traces       ${checked.length === 0 ? 'none' : checked.join(', ')}`)
    console.log(`stored spans         ${rows.length}`)
    console.log(`orphans in checked   ${outcome.orphans.length}`)
    console.log(`orphans anywhere     ${outcome.allOrphans.length}`)
    console.log(`traces API spans     ${outcome.loopSpans.length} (control call stored: ${controlStored})`)
    console.log(`SQL spans            ${outcome.sqlSpans.length}`)
    if (outcome.violations.length > 0) {
      console.log('')
      console.log('violations:')
      for (const violation of outcome.violations) console.log(`  - ${violation}`)
      const byTrace = new Map()
      for (const row of rows) {
        const entry = byTrace.get(row.trace_id) ?? []
        entry.push(row)
        byTrace.set(row.trace_id, entry)
      }
      for (const traceId of checked) {
        console.log('')
        console.log(`rows in trace ${traceId}:`)
        for (const row of byTrace.get(traceId) ?? []) {
          console.log(`  ${row.span_id} parent=${row.parent_span_id ?? 'none'} kind=${row.kind} ${row.name}`)
        }
      }
      exitCode = 1
    }
    console.log('')
    console.log(exitCode === 0 ? 'check-api-spans: OK' : 'check-api-spans: FAILED')
  } catch (error) {
    console.error(`check-api-spans: ${error instanceof Error ? error.message : String(error)}`)
    exitCode = 2
  } finally {
    if (values.keep === true)
      console.error(`check-api-spans: --keep, leaving scratch "${scratch.state.name}" up; run "dshx dev down --name ${scratch.state.name}"`)
    else await scratchDown(scratch.state, false)
  }
  return exitCode
}

process.exitCode = await main()
