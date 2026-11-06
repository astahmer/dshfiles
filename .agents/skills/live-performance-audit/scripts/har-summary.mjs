#!/usr/bin/env node
// Usage: node har-summary.mjs <file.har> [--json] [--top N]
// Reads a browser HAR (DevTools › Network › Export HAR) and summarizes the DSH `/api/` requests: queueing versus server
// time, duplicates, aborts and the plugin that owns each dshx channel. Read-only. It never prints headers, cookies,
// request or response bodies, query strings or the page URL: bodies are hashed in memory only to detect duplicates.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

const percentile = (values, fraction) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
}

const sourceFiles = directory => {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true }).flatMap(entry => {
    if (!entry.isFile() || !/\.(ts|tsx|mts)$/.test(entry.name) || /\.test\./.test(entry.name)) return []
    const parent = entry.parentPath ?? entry.path
    return parent.includes('node_modules') ? [] : [path.join(parent, entry.name)]
  })
}

const API_ID_PATTERN = /\bid:\s*['"]([a-z0-9][a-z0-9._-]*)['"]/g

/** Every `@dshfiles/*` package × every API id found in the repository, hashed the way dshx names its channels. */
export const buildChannelOwners = async ({ root = repositoryRoot } = {}) => {
  const { ApiChannelModel } = await import(pathToFileURL(path.join(root, 'tooling/dshx/packages/dshx/src/api/channel.ts')).href)
  const pluginsDirectory = path.join(root, 'plugins/@dshfiles')
  const pluginDirectories = fs.readdirSync(pluginsDirectory).map(name => path.join(pluginsDirectory, name))
  const packages = new Set(['@dshfiles/dshx'])
  const apiIds = new Set()
  const scanned = [...pluginDirectories, path.join(root, 'tooling/dshx/packages/dshx')]
  for (const directory of scanned) {
    const manifest = path.join(directory, 'package.json')
    if (fs.existsSync(manifest)) packages.add(JSON.parse(fs.readFileSync(manifest, 'utf8')).name)
    for (const file of sourceFiles(path.join(directory, 'src'))) {
      const text = fs.readFileSync(file, 'utf8')
      if (!/defineApi|owner:/.test(text)) continue
      for (const match of text.matchAll(API_ID_PATTERN)) apiIds.add(match[1])
    }
  }
  const owners = new Map()
  for (const packageName of packages) {
    for (const apiId of apiIds) owners.set(ApiChannelModel.apiChannel(packageName, apiId).slice(1), { packageName, apiId })
  }
  return owners
}

const bodyKey = entry => {
  const text = entry.request.postData?.text
  if (text === undefined) return new URL(entry.request.url).search
  try {
    const { rpcId: _rpcId, ...rest } = JSON.parse(text)
    return JSON.stringify(rest)
  } catch {
    return text
  }
}

const describeRequest = (entry, channelOwners) => {
  const segments = new URL(entry.request.url).pathname.split('/').filter(Boolean)
  const channel = segments[1] ?? ''
  const method = segments.slice(2).join('/')
  if (!channel.startsWith('dshx-')) {
    return { label: method === '' ? channel : `${channel}/${method}`, owner: 'core' }
  }
  const resolved = channelOwners.get(channel)
  if (resolved === undefined) return { label: `${channel}/${method}`, owner: `unmapped ${channel}` }
  return { label: `${resolved.apiId}/${method}`, owner: resolved.packageName }
}

const responseBytes = entry => {
  const contentSize = entry.response?.content?.size ?? 0
  return contentSize > 0 ? contentSize : Math.max(0, entry.response?.bodySize ?? 0)
}

/** Summary of the `/api/` requests of one HAR. Pure: takes the parsed HAR and a channel → owner map. */
export const summarizeHar = ({ har, channelOwners, top = 15 }) => {
  const allEntries = har.log?.entries ?? []
  const apiEntries = allEntries.filter(entry => new URL(entry.request.url).pathname.startsWith('/api/'))
  const requests = apiEntries
    .map(entry => {
      const start = Date.parse(entry.startedDateTime)
      const { label, owner } = describeRequest(entry, channelOwners)
      const status = entry.response?.status ?? 0
      const wait = Math.max(0, entry.timings?.wait ?? 0)
      return {
        label,
        owner,
        httpMethod: entry.request.method,
        start,
        time: entry.time,
        blocked: Math.max(0, entry.timings?.blocked ?? 0),
        wait,
        status,
        sent: status !== 0,
        abortedInQueue: status === 0 && wait === 0,
        requestBytes: entry.request.postData?._bodyBytes ?? Buffer.byteLength(entry.request.postData?.text ?? ''),
        responseBytes: responseBytes(entry),
        digest: crypto
          .createHash('sha1')
          .update(`${entry.request.method} ${label} ${bodyKey(entry)}`)
          .digest('hex'),
      }
    })
    .sort((left, right) => left.start - right.start)
  if (requests.length === 0) return { requests: 0, otherRequests: allEntries.length }

  const firstStart = requests[0].start
  const sent = requests.filter(request => request.sent)
  const totalTime = requests.reduce((sum, request) => sum + request.time, 0)
  const totalBlocked = requests.reduce((sum, request) => sum + request.blocked, 0)
  const lastEnd = Math.max(...requests.map(request => request.start + request.time))

  const previousStartByDigest = new Map()
  let duplicateSameSecond = 0
  for (const request of requests) {
    const previous = previousStartByDigest.get(request.digest)
    if (previous !== undefined && request.start - previous < 1000) duplicateSameSecond += 1
    previousStartByDigest.set(request.digest, request.start)
  }

  const byMethod = new Map()
  for (const request of requests) {
    const key = `${request.httpMethod} ${request.label}`
    const group = byMethod.get(key) ?? []
    group.push(request)
    byMethod.set(key, group)
  }
  const methods = [...byMethod.entries()]
    .map(([method, group]) => ({
      method,
      owner: group[0].owner,
      calls: group.length,
      distinct: new Set(group.map(request => request.digest)).size,
      abortedInQueue: group.filter(request => request.abortedInQueue).length,
      statuses: Object.fromEntries(
        [...new Set(group.map(request => request.status))].sort().map(status => [status, group.filter(request => request.status === status).length]),
      ),
      timeP50Ms: Math.round(
        percentile(
          group.map(request => request.time),
          0.5,
        ),
      ),
      waitMaxMs: Math.round(Math.max(...group.map(request => request.wait))),
      responseKB: Math.round(group.reduce((sum, request) => sum + request.responseBytes, 0) / 102.4) / 10,
    }))
    .sort((left, right) => right.calls - left.calls || right.responseKB - left.responseKB)

  const distinctDigests = new Set(requests.map(request => request.digest)).size
  return {
    requests: requests.length,
    otherRequests: allEntries.length - requests.length,
    byHttpMethod: Object.fromEntries(
      [...new Set(requests.map(request => request.httpMethod))].map(method => [method, requests.filter(request => request.httpMethod === method).length]),
    ),
    windowSeconds: Math.round((lastEnd - firstStart) / 100) / 10,
    firstSentAfterMs: sent.length === 0 ? null : Math.round(Math.min(...sent.map(request => request.start + request.blocked)) - firstStart),
    timeMs: {
      p50: Math.round(
        percentile(
          requests.map(request => request.time),
          0.5,
        ),
      ),
      p95: Math.round(
        percentile(
          requests.map(request => request.time),
          0.95,
        ),
      ),
    },
    blockedMs: {
      p50: Math.round(
        percentile(
          sent.map(request => request.blocked),
          0.5,
        ),
      ),
      p95: Math.round(
        percentile(
          sent.map(request => request.blocked),
          0.95,
        ),
      ),
    },
    waitMs: {
      p50: Math.round(
        percentile(
          sent.map(request => request.wait),
          0.5,
        ),
      ),
      p95: Math.round(
        percentile(
          sent.map(request => request.wait),
          0.95,
        ),
      ),
      max: Math.round(Math.max(0, ...sent.map(request => request.wait))),
    },
    shareQueued: totalTime === 0 ? 0 : Math.round((totalBlocked / totalTime) * 100) / 100,
    abortedInQueue: requests.filter(request => request.abortedInQueue).length,
    abortedAfterSend: requests.filter(request => !request.sent && !request.abortedInQueue).length,
    duplicates: { extraCalls: requests.length - distinctDigests, withinOneSecond: duplicateSameSecond },
    non2xx: requests.filter(request => request.sent && (request.status < 200 || request.status >= 300)).length,
    bytes: {
      requestKB: Math.round(requests.reduce((sum, request) => sum + request.requestBytes, 0) / 1024),
      responseKB: Math.round(requests.reduce((sum, request) => sum + request.responseBytes, 0) / 1024),
    },
    unmappedChannels: [...new Set(requests.filter(request => request.owner.startsWith('unmapped')).map(request => request.owner))],
    topMethods: methods.slice(0, top),
  }
}

const formatText = summary => {
  if (summary.requests === 0) return `No /api/ requests (${summary.otherRequests} other entries).`
  const lines = [
    `requests        ${summary.requests} /api/ (${Object.entries(summary.byHttpMethod)
      .map(([method, count]) => `${count} ${method}`)
      .join(', ')}), ${summary.otherRequests} other, over ${summary.windowSeconds} s`,
    `first sent      ${summary.firstSentAfterMs === null ? 'never' : `${summary.firstSentAfterMs} ms`} after the first request was issued`,
    `time            p50 ${summary.timeMs.p50} ms, p95 ${summary.timeMs.p95} ms`,
    `blocked (queue) p50 ${summary.blockedMs.p50} ms, p95 ${summary.blockedMs.p95} ms, ${Math.round(summary.shareQueued * 100)} % of request time`,
    `wait (server)   p50 ${summary.waitMs.p50} ms, p95 ${summary.waitMs.p95} ms, max ${summary.waitMs.max} ms`,
    `aborted         ${summary.abortedInQueue} before being sent, ${summary.abortedAfterSend} after`,
    `duplicates      ${summary.duplicates.extraCalls} extra calls with the same method + body, ${summary.duplicates.withinOneSecond} within 1 s`,
    `non-2xx         ${summary.non2xx}`,
    `bytes           ${summary.bytes.requestKB} KB sent, ${summary.bytes.responseKB} KB received`,
  ]
  if (summary.unmappedChannels.length > 0) lines.push(`unmapped        ${summary.unmappedChannels.join(', ')}`)
  lines.push('', 'calls distinct aborted  p50ms waitMax    KB  statuses        method · owner')
  for (const row of summary.topMethods) {
    const statuses = Object.entries(row.statuses)
      .map(([status, count]) => `${status}×${count}`)
      .join(' ')
    lines.push(
      `${String(row.calls).padStart(5)} ${String(row.distinct).padStart(8)} ${String(row.abortedInQueue).padStart(7)} ${String(row.timeP50Ms).padStart(6)} ${String(row.waitMaxMs).padStart(7)} ${String(row.responseKB).padStart(5)}  ${statuses.padEnd(15)} ${row.method} · ${row.owner}`,
    )
  }
  return lines.join('\n')
}

/** Text summary of one HAR file, for har-capture.mjs --summary. */
export const summarizeHarFile = async harPath =>
  formatText(summarizeHar({ har: JSON.parse(fs.readFileSync(harPath, 'utf8')), channelOwners: await buildChannelOwners() }))

const main = async () => {
  const [harPath, ...flags] = process.argv.slice(2)
  if (harPath === undefined || harPath.startsWith('-')) {
    console.error('usage: node har-summary.mjs <file.har> [--json] [--top N]')
    process.exit(1)
  }
  const topIndex = flags.indexOf('--top')
  const top = topIndex === -1 ? 15 : Number(flags[topIndex + 1])
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'))
  const summary = summarizeHar({ har, channelOwners: await buildChannelOwners(), top })
  console.log(flags.includes('--json') ? JSON.stringify(summary, null, 2) : formatText(summary))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
