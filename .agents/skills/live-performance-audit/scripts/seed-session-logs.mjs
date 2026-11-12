// SCRATCH ONLY: copy a bounded set of real Session logs into a scratch DSH home so probes see representative threads.
// Each zstd frame is decompressed, the source project's cwd is rewritten to the scratch project, and the frame is
// compressed again (mode 600). It only reads the source folder. Copying private threads needs the person's explicit
// authorization; keep the copy and anything derived from it out of the repository.
// Usage: node seed-session-logs.mjs --from <~/.dsh/sessions/--<project>--> --home <scratch DSH_HOME>
//          --project <scratch project dir> --source-cwd <project dir the logs were recorded in> [--ids <file>]
//   Without --ids it takes the 6 largest logs between 2.5 and 6 MB plus the 34 most recent smaller ones idle for an hour.
//   Prints the copied ids, one per line, for the probes' IDS file.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

const { values } = parseArgs({
  options: { from: { type: 'string' }, home: { type: 'string' }, project: { type: 'string' }, 'source-cwd': { type: 'string' }, ids: { type: 'string' } },
})
const { from, home, project } = values
const sourceCwd = values['source-cwd']
if (from === undefined || home === undefined || project === undefined || sourceCwd === undefined) {
  throw new Error('Usage: seed-session-logs.mjs --from <sessions dir> --home <scratch DSH_HOME> --project <dir> --source-cwd <dir> [--ids <file>]')
}

// Split a zstd file into its frames (RFC 8878 §3.1.1) without decoding them.
const frames = buffer => {
  const out = []
  let offset = 0
  while (offset + 4 <= buffer.length) {
    const start = offset
    offset += 4
    const descriptor = buffer.readUInt8(offset++)
    const sizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    offset += (singleSegment ? 0 : 1) + (dictionaryFlag === 3 ? 4 : dictionaryFlag) + (sizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << sizeFlag)
    for (;;) {
      const header = buffer.readUIntLE(offset, 3)
      offset += 3
      offset += ((header >>> 1) & 3) === 1 ? 1 : header >>> 3
      if (header & 1) break
    }
    if (checksum) offset += 4
    out.push(buffer.subarray(start, offset))
  }
  return out
}

const logs = readdirSync(from).flatMap(id => {
  const file = `${from}/${id}/session.v4.jsonl.zstd`
  if (!existsSync(file)) return []
  const stat = statSync(file)
  return [{ id, file, size: stat.size, mtime: stat.mtimeMs }]
})
const wanted = values.ids === undefined ? undefined : new Set(readFileSync(values.ids, 'utf8').split('\n').filter(Boolean))
const chosen = (() => {
  if (wanted !== undefined) return logs.filter(log => wanted.has(log.id))
  const long = logs.filter(log => log.size > 2_500_000 && log.size < 6_000_000).sort((left, right) => right.size - left.size).slice(0, 6)
  const recent = logs
    .filter(log => !long.includes(log) && log.size < 2_500_000 && Date.now() - log.mtime > 3_600_000)
    .sort((left, right) => right.mtime - left.mtime)
    .slice(0, 34)
  return [...long, ...recent]
})()

const destination = `${home}/sessions/--${project.replaceAll('/', '-').replace(/^-/, '')}--`
mkdirSync(destination, { recursive: true })
let decodedBytes = 0
for (const log of chosen) {
  const parts = frames(readFileSync(log.file)).map(frame => {
    const text = zstdDecompressSync(frame).toString().replaceAll(JSON.stringify(sourceCwd), JSON.stringify(project))
    decodedBytes += text.length
    return zstdCompressSync(Buffer.from(text), { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
  })
  mkdirSync(`${destination}/${log.id}`, { recursive: true })
  writeFileSync(`${destination}/${log.id}/session.v4.jsonl.zstd`, Buffer.concat(parts), { mode: 0o600 })
  console.log(log.id)
}
console.error(`copied ${chosen.length} logs, ${Math.round(decodedBytes / 1e6)} MB decoded`)
