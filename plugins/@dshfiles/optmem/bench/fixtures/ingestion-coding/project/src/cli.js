import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { ingest } from './ingest.js'
import { summarize } from './report.js'
import { openStore } from './store.js'

const { values } = parseArgs({
  options: { state: { type: 'string' }, organization: { type: 'string' }, provider: { type: 'string' }, responses: { type: 'string' } },
})
if (Object.values(values).length !== 4) throw new Error('usage: --state <file> --organization <id> --provider <id> --responses <json>')
const responses = JSON.parse(await readFile(values.responses, 'utf8'))
const store = await openStore({ file: values.state })
const result = await ingest({
  store,
  organization: values.organization,
  provider: values.provider,
  fetchPage: async () => responses.shift() ?? { status: 503 },
  sleep: async () => {},
})
const summary = summarize({ snapshot: store.snapshot(), organization: values.organization, provider: values.provider })
process.stdout.write(`${JSON.stringify({ result, summary })}\n`)
