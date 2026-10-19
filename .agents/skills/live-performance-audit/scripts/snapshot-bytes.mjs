// Break a dumped session/follow opening snapshot down by event type and by the field paths that carry the bytes.
// Usage: node snapshot-bytes.mjs <snapshot.json>   (written by switch-probe.mjs DUMP=…)
import { readFileSync } from 'node:fs'

const frame = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const records = frame.value?.records ?? []
const byType = new Map()
const byPath = new Map()
const walk = (value, path) => {
  if (value === null || typeof value !== 'object') {
    const bytes = String(value).length
    byPath.set(path, (byPath.get(path) ?? 0) + bytes)
    return
  }
  for (const [key, child] of Object.entries(value)) walk(child, Array.isArray(value) ? `${path}[]` : `${path}.${key}`)
}
for (const record of records) {
  const type = record.event?.type ?? record.type
  byType.set(type, (byType.get(type) ?? 0) + JSON.stringify(record).length)
  walk(record.event?.data ?? record, type)
}
const mb = bytes => (bytes / 1e6).toFixed(2).padStart(7)
console.log(`${records.length} records, ${mb(JSON.stringify(frame).length)} MB, hasMore=${frame.value?.hasMore}`)
for (const [type, bytes] of [...byType].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`${mb(bytes)} MB  ${type}`)
console.log('heaviest field paths:')
for (const [path, bytes] of [...byPath].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`${mb(bytes)} MB  ${path}`)
