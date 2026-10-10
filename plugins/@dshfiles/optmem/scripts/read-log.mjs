import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
const buf = readFileSync(process.argv[2])
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let i = buf.indexOf(magic); i >= 0; i = buf.indexOf(magic, i + 1)) starts.push(i)
const text = starts.map((s, k) => zstdDecompressSync(buf.subarray(s, starts[k + 1] ?? buf.length)).toString()).join('')
const lines = text
  .split('\n')
  .filter(Boolean)
  .map(l => JSON.parse(l))
const filter = process.argv[3]
for (const e of lines.slice(1)) {
  if (filter && !filter.split(',').includes(e.type)) continue
  console.log(JSON.stringify(e).slice(0, Number(process.argv[4] ?? 400)))
}
