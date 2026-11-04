/**
 * Read one browser HAR of a DSH page load and report where its requests went.
 *
 * Read-only: the HAR is parsed in memory and never written. Prints the request
 * groups, the slowest entries, per-pattern repeats with the gap between them,
 * and the waterfall around the page's own load markers.
 *
 *   node plans/performance-optimization/evidence/har-requests.mjs <file.har> [--json out.json]
 *
 * `dshx-<hash>/<method>` channels resolve to `@dshfiles/<plugin>` through the
 * plugin list the caller passes with `--plugins`, or stay hashed.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const kib = (bytes) => `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KiB`
const ms = (value) => Math.round(value)
const seconds = (value) => (value / 1000).toFixed(2)

/** The channel a dshx API answers on: `/dshx-<fnv1a32(packageId\0apiId)>`. */
const apiChannel = (packageId, apiId) => {
  let hash = 2166136261
  const value = `${packageId}\0${apiId}`
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `dshx-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

const patternOf = (url) => {
  const parsed = new URL(url)
  if (parsed.pathname.startsWith('/api/')) {
    const parts = parsed.pathname.split('/').filter(Boolean)
    return `api/${parts.slice(1).join('/')}`
  }
  if (parsed.pathname.startsWith('/plugins/')) return 'plugins bundle'
  return parsed.pathname
}

const groupOf = (url) => {
  const path = patternOf(url)
  if (path.startsWith('api/dshx-')) return `plugin ${path.split('/')[1]}`
  if (path.startsWith('api/')) return `native ${path.split('/')[1]}`
  return 'static'
}

const load = (file) => {
  const har = JSON.parse(readFileSync(file, 'utf8'))
  const started = har.log.entries.map((entry) => Date.parse(entry.startedDateTime))
  const origin = Math.min(...started)
  return {
    entries: har.log.entries.map((entry, index) => ({
      ...entry,
      at: started[index] - origin,
      end: started[index] - origin + entry.time,
      path: patternOf(entry.request.url),
      group: groupOf(entry.request.url),
      decoded: entry.response.content.size ?? 0,
      transfer: entry.response._transferSize ?? 0,
      ttfb: Math.max(0, entry.timings.wait ?? 0),
      blocked: Math.max(0, entry.timings.blocked ?? 0),
    })),
    page: har.log.pages?.[0],
    window: Math.max(...har.log.entries.map((entry, index) => started[index] - origin + entry.time)),
  }
}

const byPattern = (entries) => {
  const rows = new Map()
  for (const entry of entries) {
    const row = rows.get(entry.path) ?? { path: entry.path, group: entry.group, count: 0, decoded: 0, transfer: 0, maxTime: 0, maxTtfb: 0, starts: [] }
    row.count += 1
    row.decoded += entry.decoded
    row.transfer += entry.transfer
    row.maxTime = Math.max(row.maxTime, entry.time)
    row.maxTtfb = Math.max(row.maxTtfb, entry.ttfb)
    row.starts.push(entry.at)
    rows.set(entry.path, row)
  }
  return [...rows.values()].sort((left, right) => right.decoded - left.decoded)
}

const repeats = (entries) => {
  const rows = new Map()
  for (const entry of entries) {
    const key = `${entry.request.method} ${entry.path}`
    const row = rows.get(key) ?? { key, at: [] }
    row.at.push(entry.at)
    rows.set(key, row)
  }
  return [...rows.values()]
    .filter((row) => row.at.length > 1)
    .map((row) => {
      const gaps = row.at.slice(1).map((at, index) => at - row.at[index])
      return { key: row.key, count: row.at.length, gaps, withinOneSecond: gaps.filter((gap) => gap <= 1000).length }
    })
    .sort((left, right) => right.count - left.count)
}

/** The requests whose completion falls either side of a load marker: what the first paint waited on. */
const criticalPath = (entries, marker) => entries.filter((entry) => entry.at <= marker).sort((left, right) => right.end - left.end)

const report = ({ entries, page, window }) => {
  const decoded = entries.reduce((sum, entry) => sum + entry.decoded, 0)
  const transfer = entries.reduce((sum, entry) => sum + entry.transfer, 0)
  const lines = []
  const say = (line = '') => lines.push(line)

  say(`# ${entries.length} requests, ${kib(decoded)} decoded, ${kib(transfer)} transferred, over ${seconds(window)} s`)
  if (page) {
    const timings = page.pageTimings ?? {}
    say(`markers: DOMContentLoaded ${ms(timings.onContentLoad ?? 0)} ms, load ${ms(timings.onLoad ?? 0)} ms`)
  }
  say()

  say('## Groups')
  const groups = new Map()
  for (const entry of entries) {
    const row = groups.get(entry.group) ?? { group: entry.group, count: 0, decoded: 0, transfer: 0 }
    row.count += 1
    row.decoded += entry.decoded
    row.transfer += entry.transfer
    groups.set(entry.group, row)
  }
  for (const row of [...groups.values()].sort((left, right) => right.decoded - left.decoded)) {
    say(`- ${row.group}: ${row.count} requests, ${kib(row.decoded)} decoded, ${kib(row.transfer)} transferred`)
  }
  say()

  say('## Patterns by decoded bytes')
  say('| requests | decoded | transferred | slowest | slowest TTFB | pattern |')
  say('| ---: | ---: | ---: | ---: | ---: | --- |')
  for (const row of byPattern(entries)) {
    say(`| ${row.count} | ${kib(row.decoded)} | ${kib(row.transfer)} | ${ms(row.maxTime)} ms | ${ms(row.maxTtfb)} ms | \`${row.path}\` |`)
  }
  say()

  say('## 20 slowest')
  say('| start | wall | TTFB | status | decoded | pattern |')
  say('| ---: | ---: | ---: | ---: | ---: | --- |')
  for (const entry of [...entries].sort((left, right) => right.time - left.time).slice(0, 20)) {
    say(`| ${ms(entry.at)} ms | ${ms(entry.time)} ms | ${ms(entry.ttfb)} ms | ${entry.response.status} | ${kib(entry.decoded)} | \`${entry.path}\` |`)
  }
  say()

  say('## Repeats (gap between consecutive identical requests)')
  for (const row of repeats(entries)) {
    const worst = Math.min(...row.gaps)
    say(`- ${row.key}: ${row.count}×, closest gap ${ms(worst)} ms, ${row.withinOneSecond} gap(s) ≤ 1 s`)
  }
  say()

  if (page) {
    for (const label of ['onContentLoad', 'onLoad']) {
      const marker = page.pageTimings?.[label] ?? 0
      const inWindow = criticalPath(entries, marker)
      say(`## Requests still open at ${label} (${ms(marker)} ms)`)
      for (const entry of inWindow.slice(0, 12)) {
        say(`- ${ms(entry.at)}→${ms(entry.end)} ms (${ms(entry.time)} ms), ${kib(entry.decoded)}, \`${entry.path}\``)
      }
      say()
    }
  }

  const longLived = entries.filter((entry) => entry.time >= 1000)
  say('## Long-lived (≥ 1 s)')
  for (const entry of longLived.sort((left, right) => right.time - left.time)) {
    say(`- ${ms(entry.at)}→${ms(entry.end)} ms: ${ms(entry.time)} ms, TTFB ${ms(entry.ttfb)} ms, \`${entry.path}\` (${entry.response.content.mimeType})`)
  }

  return { text: lines.join('\n'), entries, page, window }
}

const resolveChannels = (entries, plugins) => {
  const resolved = new Map()
  for (const plugin of plugins) {
    for (const apiId of plugin.apis) resolved.set(apiChannel(plugin.name, apiId), { plugin: plugin.name, api: apiId })
  }
  return entries.map((entry) => {
    const match = /^api\/(dshx-[0-9a-f]+)\//.exec(entry.path)
    const resolvedChannel = match === null ? undefined : resolved.get(match[1])
    return resolvedChannel === undefined
      ? entry
      : { ...entry, group: `plugin ${resolvedChannel.plugin} ${resolvedChannel.api}`, path: `${entry.path} (${resolvedChannel.plugin} ${resolvedChannel.api})` }
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [, , file, ...rest] = process.argv
  if (file === undefined) {
    console.error('usage: har-requests.mjs <file.har> [--plugins plugins.json] [--json out.json]')
    process.exit(1)
  }
  const pluginsAt = rest.indexOf('--plugins')
  const jsonAt = rest.indexOf('--json')
  const loaded = load(file)
  const plugins = pluginsAt === -1 ? [] : JSON.parse(readFileSync(rest[pluginsAt + 1], 'utf8'))
  const entries = plugins.length === 0 ? loaded.entries : resolveChannels(loaded.entries, plugins)
  const result = report({ ...loaded, entries })
  console.log(result.text)
  if (jsonAt !== -1) {
    writeFileSync(
      rest[jsonAt + 1],
      JSON.stringify(
        {
          windowMs: Math.round(loaded.window),
          requests: entries.length,
          decodedBytes: entries.reduce((sum, entry) => sum + entry.decoded, 0),
          transferBytes: entries.reduce((sum, entry) => sum + entry.transfer, 0),
          pageTimings: loaded.page?.pageTimings,
          patterns: byPattern(entries).map(({ starts, ...row }) => ({ ...row, maxTime: Math.round(row.maxTime), maxTtfb: Math.round(row.maxTtfb) })),
          repeats: repeats(entries),
        },
        undefined,
        1,
      ),
    )
  }
}
