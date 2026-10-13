// Deterministic scenario data. `generateFixture(name, projectDir)` writes the project files a scenario needs and returns
// the ground truth its probes are scored against (and the long documents its prompts paste, via {{truth.*}}).
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareFixture as prepareIngestionCodingFixture } from './fixtures/ingestion-coding/prepare.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const random = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}

const hex = (next, length) => Array.from({ length }, () => Math.floor(next() * 16).toString(16)).join('')
const pick = (next, items) => items[Math.floor(next() * items.length)]
const iso = ms => new Date(ms).toISOString()
const countBy = (items, key) => items.reduce((counts, item) => counts.set(key(item), (counts.get(key(item)) ?? 0) + 1), new Map())
const top = counts => [...counts].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))[0]

const financeSpec = `FIN-SPEC-112 — Invoice computation rules (excerpt, rev. C)

1. Amounts. All amounts are stored and computed as integer minor units (cents). Floating point values are rejected at the
   boundary. Display formatting is a presentation concern and never feeds back into computation.
2. Lines. A line has a description, a quantity and a unit price. Quantity is a positive integer; fractional quantities are
   not allowed for the billing products in scope (seats, licenses, support packs). A line amount is quantity × unit price.
3. Discounts. At most one discount code applies per invoice. A discount is applied to the pre-tax amount. Percentage
   discounts apply to every line. Fixed discounts are spread across lines in proportion to each line's amount using a
   largest-remainder allocation, so the per-line discounts are integers and add up exactly to the fixed amount. A fixed
   discount larger than the subtotal is capped at the subtotal.
4. Tax. VAT is computed per line on the discounted line amount, rounding half-up to the cent, then summed. The invoice
   region determines the rate. An invoice for a region without a configured rate is an error, never a zero-tax invoice.
5. Totals. subtotal = sum of line amounts before discount; discount = total discount; tax = sum of per-line VAT;
   total = subtotal − discount + tax.
6. Export. The accounting CSV follows RFC 4180: fields containing a comma, a double quote, CR or LF are enclosed in double
   quotes and embedded double quotes are doubled. Line endings are CRLF.
7. Errors. Errors carry a stable machine-readable code; messages are for humans and may change.
`

const coding = async project => {
  await cp(join(fixturesRoot, 'coding'), project, { recursive: true })
  return { financeSpec }
}

const logs = async project => {
  const next = random(20261007)
  const start = Date.parse('2026-10-07T13:00:00Z')
  const routes = ['/v1/orders', '/v1/orders/:id', '/v1/payments', '/v1/users/me', '/v1/search', '/v1/invoices', '/healthz']
  const tenants = ['t-acme', 't-globex', 't-initech', 't-umbrella', 't-hooli']
  const gateway = []
  for (let index = 0; index < 4000; index++) {
    const at = start + Math.floor((index / 4000) * 3 * 3600_000) + Math.floor(next() * 2000)
    const minute = new Date(at).getUTCHours() * 60 + new Date(at).getUTCMinutes()
    const burst = minute >= 14 * 60 + 20 && minute < 14 * 60 + 35
    const route = burst && next() < 0.45 ? '/v1/payments' : pick(next, routes)
    const tenant = burst && route === '/v1/payments' && next() < 0.8 ? 't-globex' : pick(next, tenants)
    let status = next() < 0.012 ? 500 : next() < 0.01 ? 404 : 200
    if (burst && route === '/v1/payments' && next() < 0.7) status = 503
    if (route === '/v1/orders' && next() < 0.05) status = 201
    const duration = Math.round(route === '/healthz' ? 1 + next() * 4 : 20 + next() ** 3 * (status >= 500 ? 4000 : 1800))
    gateway.push({ at, route, tenant, status, duration, trace: `tr-${hex(next, 8)}`, method: route === '/v1/orders' && status === 201 ? 'POST' : 'GET' })
  }
  const slowest = gateway[2711]
  Object.assign(slowest, { route: '/v1/search', tenant: 't-initech', status: 200, duration: 9874, trace: 'tr-7f3a9c21' })
  const gatewayText = gateway
    .map(
      line =>
        `${iso(line.at)} level=${line.status >= 500 ? 'error' : 'info'} svc=gateway method=${line.method} route=${line.route} status=${line.status} dur_ms=${line.duration} trace=${line.trace} tenant=${line.tenant}`,
    )
    .join('\n')
  const errors = gateway.filter(line => line.status >= 500)
  const in14 = line => new Date(line.at).getUTCHours() === 14
  const maxDuration = Math.max(...gateway.map(line => line.duration))

  const jobTypes = ['invoice.render', 'invoice.email', 'ledger.sync', 'report.daily', 'webhook.deliver']
  const worker = []
  let job = 41000
  for (let index = 0; worker.length < 2500; index++) {
    job += 1 + Math.floor(next() * 7)
    const at = start + Math.floor((index / 1900) * 3 * 3600_000)
    const type = pick(next, jobTypes)
    const attempts = next() < 0.06 ? 2 + Math.floor(next() * 3) : 1
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const failed = attempt < attempts
      worker.push({
        at: at + attempt * 1500,
        text: `level=${failed ? 'warn' : 'info'} svc=worker job=job-${job} type=${type} attempt=${attempt} status=${failed ? 'retry' : 'ok'} dur_ms=${Math.round(50 + next() * 900)}${failed ? ` error=${pick(next, ['ConnectionReset', 'Timeout', 'Unavailable'])}` : ''}`,
        status: failed ? 'retry' : 'ok',
        job,
      })
    }
  }
  const exhausted = Date.parse('2026-10-07T14:41:12Z')
  for (let attempt = 1; attempt <= 5; attempt++)
    worker.push({
      at: exhausted - (5 - attempt) * 30_000,
      text: `level=${attempt === 5 ? 'error' : 'warn'} svc=worker job=job-48213 type=ledger.sync attempt=${attempt} status=${attempt === 5 ? 'failed' : 'retry'} dur_ms=30000 error=DeadlineExceeded${attempt === 5 ? ' msg="giving up after 5 retries"' : ''}`,
      status: attempt === 5 ? 'failed' : 'retry',
      job: 48213,
    })
  worker.push({
    at: Date.parse('2026-10-07T14:27:03Z'),
    text: 'level=error svc=worker msg="container killed" reason=OOMKilled memory_limit=512Mi job=job-51007 type=report.daily',
    status: 'killed',
    job: 51007,
  })
  worker.sort((left, right) => left.at - right.at)
  const workerText = worker.map(line => `${iso(line.at)} ${line.text}`).join('\n')

  const tables = ['orders', 'payments', 'users', 'invoices', 'ledger_entries']
  const slow = Array.from({ length: 300 }, (_, index) => {
    const table = next() < 0.34 ? 'ledger_entries' : pick(next, tables)
    return {
      at: start + Math.floor((index / 300) * 3 * 3600_000),
      table,
      seconds: Number((1 + next() ** 2 * 11).toFixed(2)),
      rows: Math.floor(10_000 + next() * 900_000),
    }
  })
  slow[187] = { ...slow[187], table: 'payments', seconds: 41.37, rows: 2_418_002 }
  const slowText = slow
    .map(
      query =>
        `# Time: ${iso(query.at)}\n# User@Host: billing[billing] @ 10.4.2.${Math.floor(next() * 200)}\n# Query_time: ${query.seconds.toFixed(2)}  Lock_time: 0.00  Rows_examined: ${query.rows}\nSELECT * FROM ${query.table} WHERE tenant_id = ? AND created_at > ? ORDER BY created_at DESC;`,
    )
    .join('\n')
  const slowTables = top(countBy(slow, query => query.table))

  await mkdir(join(project, 'logs'), { recursive: true })
  await writeFile(join(project, 'logs/api-gateway.log'), `${gatewayText}\n`)
  await writeFile(join(project, 'logs/worker.log'), `${workerText}\n`)
  await writeFile(join(project, 'logs/db-slow.log'), `${slowText}\n`)
  await writeFile(
    join(project, 'README.md'),
    '# billing incident 2026-10-07\n\nLogs exported from the billing cluster for the 13:00–16:00 UTC window: `logs/api-gateway.log`, `logs/worker.log`, `logs/db-slow.log` (MySQL slow log).\n',
  )
  return {
    gatewayLines: gateway.length,
    errors5xx: errors.length,
    errors503In14: gateway.filter(line => line.status === 503 && in14(line)).length,
    slowestTrace: gateway.find(line => line.duration === maxDuration).trace,
    slowestMs: maxDuration,
    topErrorTenant: top(countBy(errors, line => line.tenant))[0],
    topErrorRoute: top(countBy(errors, line => line.route))[0],
    exhaustedJob: 'job-48213',
    oomJob: 'job-51007',
    failedJobs: worker.filter(line => line.status === 'failed').length,
    slowQueries: slow.length,
    topSlowTable: slowTables[0],
    topSlowTableCount: slowTables[1],
    slowestQuerySeconds: '41.37',
    slowestQueryTable: 'payments',
  }
}

const support = async () => {
  const next = random(4242)
  const areas = ['broker', 'consumer', 'producer', 'admin API', 'tiered storage', 'metrics', 'halyardctl', 'schema registry', 'TLS', 'quotas']
  const verbs = ['Fixed', 'Improved', 'Added', 'Deprecated', 'Reduced', 'Hardened']
  const objects = [
    'leader election when a broker restarts during a rolling upgrade',
    'memory usage of the fetch session cache under many idle consumers',
    'a race between log segment roll and retention cleanup',
    'the `/v1/health` endpoint so it reports partial outages',
    'metric names for request latency histograms (old names kept until 5.0)',
    'certificate reload without a broker restart',
    'per-tenant byte-rate quotas enforced on the produce path',
    'backpressure when tiered storage uploads fall behind',
    'consumer group rebalance timeouts on large groups (cooperative-sticky is now the default)',
    'compaction throughput on topics with many small keys',
  ]
  const releaseLines = Array.from({ length: 46 }, (_, index) => {
    const area = pick(next, areas)
    return `- **${area}**: ${pick(next, verbs)} ${pick(next, objects)} (HLY-${3100 + index * 7}).`
  })
  releaseLines.splice(
    23,
    0,
    '- **producer**: The `max.inflight.requests` default was raised from 5 to 11; clients that require strict ordering without idempotence must pin it to 1 (HLY-3266).',
  )
  const releaseNotes = `# Halyard 4.2.0 release notes\n\nReleased 2026-09-30. Upgrade brokers first, then clients. Rolling upgrades from 4.0 and 4.1 are supported.\n\n## Changes\n\n${releaseLines.join('\n')}\n\n## Known issues\n\n- Brokers on 4.1.x may log spurious \`UNKNOWN_LEADER_EPOCH\` warnings while a 4.2 broker joins; they stop after the upgrade.\n- \`halyardctl topics describe --all\` is slow on clusters with more than 20k partitions.\n`

  const keys = [
    'num.network.threads',
    'num.io.threads',
    'socket.send.buffer.bytes',
    'socket.receive.buffer.bytes',
    'log.segment.bytes',
    'log.retention.check.interval.ms',
    'num.replica.fetchers',
    'replica.fetch.max.bytes',
    'offsets.retention.minutes',
    'group.initial.rebalance.delay.ms',
    'quota.window.num',
    'tiered.upload.parallelism',
    'tiered.segment.cache.bytes',
    'connections.max.idle.ms',
    'controller.quorum.fetch.timeout.ms',
  ]
  const configLines = []
  for (let section = 0; section < 9; section++) {
    configLines.push(
      `\n# --- pool ${['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'][section]} (${pick(next, ['m7g.2xlarge', 'm7g.4xlarge', 'r7g.2xlarge'])}) ---`,
    )
    for (const key of keys) configLines.push(`pool.${section}.${key}=${Math.floor(1 + next() * 9) * 10 ** Math.floor(1 + next() * 5)}`)
  }
  configLines.splice(70, 0, 'replica.lag.max.ms=45000')
  const euWestConfig = `# halyard broker overrides — region eu-west-1, cluster hx-prod-amber\n# generated by halyard-config 2.8, do not edit by hand\nbroker.rack=eu-west-1a\nlog.retention.hours=72\nunclean.leader.election.enable=false\nmin.insync.replicas=2${configLines.join('\n')}\n`

  const emailThread = `From: Hannah Okafor <h.okafor@northwind-freight.example>\nTo: support@halyard.example\nSubject: Re: Re: Lag on the shipments topic after your Tuesday incident\n\nHi team,\n\nThanks for the post-incident summary. A few follow-ups from our side after reviewing it with our platform group:\n\n1. We still see consumer lag spikes on \`shipments.v3\` roughly every 40 minutes, peaking around 180k messages, and they line up with our consumer pods being rescheduled. Is that the same rebalance behaviour, or something new?\n2. Our compliance team asked us to confirm in writing that our custom retention is still in place after the maintenance — we were told it would not be reset to the default.\n3. We would like to move to the 4.2 client because of the cooperative rebalancing default. Is there anything we should change in our producer configuration when we do that? We rely on per-key ordering.\n4. Can we get a call with your engineering team? Thursday at 15:30 CET works best for us; Friday morning is a fallback.\n\nWe are also planning a load test on 2026-10-21 at about 3x our normal peak (normal peak is ~42k msg/s). Please let us know if we need to raise quotas in advance.\n\nBest regards,\nHannah Okafor\nPlatform Lead, Northwind Freight\n\n-----Original Message-----\nFrom: support@halyard.example\nSent: Wednesday\nSubject: Re: Lag on the shipments topic after your Tuesday incident\n\nHello Hannah,\n\nWe have published the incident report. In short: a configuration push restarted consumer coordinators in a short window, which triggered repeated rebalances across large consumer groups. Messages were not lost; delivery was delayed by up to 26 minutes for some groups. We have added a guard to the config pipeline so coordinator restarts are staggered.\n\nKind regards,\nHalyard Support\n`

  const runbookSteps = [
    'Announce the maintenance in #halyard-ops and open a change ticket (template CHG-HALYARD-ROLL).',
    'Check cluster health: `halyardctl cluster health --cluster <name>`; every partition must report ISR >= min.insync.replicas.',
    'Pause automated partition reassignment: `halyardctl balancer pause --reason maintenance`.',
    'Pick the broker to roll; never roll two brokers in the same rack at once.',
    'Confirm the broker is not the active controller: `halyardctl controller show`. If it is, move leadership first with `halyardctl controller resign`.',
    'Move partition leadership away: `halyardctl leaders evacuate --broker <id> --timeout 5m`.',
    'Drain client connections: `halyardctl drain --grace 90s --broker <id>`; wait for the drain to report 0 active connections.',
    'Stop the broker service and apply the package or config change.',
    'Start the broker and wait until `halyardctl broker status <id>` reports `RUNNING` and under-replicated partitions reach 0.',
    'Restore preferred leaders: `halyardctl leaders rebalance --broker <id>`.',
    'Repeat steps 4–10 for the next broker after a 10 minute soak.',
    'Resume the balancer: `halyardctl balancer resume`, close the change ticket and post a summary in #halyard-ops.',
  ]
  const runbook = `# Runbook: rolling broker restart (Halyard 4.x)\n\nOwner: platform-messaging. Last reviewed 2026-08-14.\n\nUse this procedure for package upgrades, JVM flag changes and config changes that need a restart. Expected duration: 25–40 minutes per broker on production clusters.\n\n## Preconditions\n\n- No open SEV1/SEV2 incident on the cluster.\n- Under-replicated partitions = 0 for at least 15 minutes.\n- The on-call engineer is aware and reachable.\n\n## Steps\n\n${runbookSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n\n## Rollback\n\nIf a broker fails to rejoin within 20 minutes, stop the procedure, reinstall the previous package version on that broker only, and page the escalation manager.\n`

  const metricsRows = ['time_utc,partition,consumer_lag,bytes_in_per_s,bytes_out_per_s']
  for (let minute = 0; minute < 90; minute++) {
    const partition = Math.floor(next() * 24)
    const lag = Math.floor(next() ** 4 * 900_000)
    metricsRows.push(`14:${String(minute % 60).padStart(2, '0')}:00,${partition},${lag},${Math.floor(2e6 + next() * 9e6)},${Math.floor(2e6 + next() * 9e6)}`)
  }
  metricsRows.splice(57, 0, '14:56:00,17,1284330,9918231,1022331')
  const metricsCsv = metricsRows.join('\n')
  return { releaseNotes, euWestConfig, emailThread, runbook, metricsCsv }
}

const ingestionCoding = project => prepareIngestionCodingFixture({ project })

const generators = { coding, logs, support, 'ingestion-coding': ingestionCoding }

export const generateFixture = async (name, project) => {
  if (name === undefined) return {}
  const generator = generators[name]
  if (generator === undefined) throw new Error(`unknown fixture ${name}`)
  return generator(project)
}
