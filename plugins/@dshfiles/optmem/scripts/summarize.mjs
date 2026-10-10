// Usage: node summarize.mjs <run.json> [<run.json> …] — per-run token/cache table from drive.mjs output.
import { readFile } from 'node:fs/promises'

for (const file of process.argv.slice(2)) {
  const run = JSON.parse(await readFile(file, 'utf8'))
  let input = 0
  let cacheRead = 0
  let output = 0
  const rows = run.turns.map(turn => {
    const usage = turn.assistant.map(step => step.usage ?? {})
    const turnInput = usage.reduce((sum, item) => sum + (item.inputTokens ?? 0) + (item.cacheReadTokens ?? 0), 0)
    const turnCache = usage.reduce((sum, item) => sum + (item.cacheReadTokens ?? 0), 0)
    input += turnInput
    cacheRead += turnCache
    output += usage.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0)
    const sent = turn.overrides.map(item => `${item.originalCount}→${item.sentCount}`).join(' ')
    const bytes = turn.overrides.map(item => `${item.originalBytes ?? '?'}→${item.sentBytes ?? '?'}`).join(' ')
    return `| ${turn.session.slice(-6)} | ${turn.turn} | ${turnInput} | ${turnCache} | ${sent || '-'} | ${bytes || '-'} | ${turn.end?.kind ?? '?'} |`
  })
  console.log(`\n## ${file} (${run.mode})\n`)
  console.log('| session | turn | input tok (incl. cache) | cache read | msgs orig→sent | bytes orig→sent | end |\n|---|---|---|---|---|---|---|')
  console.log(rows.join('\n'))
  console.log(`\ntotal input ${input}, cache read ${cacheRead} (${input ? ((100 * cacheRead) / input).toFixed(1) : 0}%), output ${output}`)
}
