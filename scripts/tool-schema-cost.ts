import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as Schema from 'effect/Schema'
import { SessionLogs } from './self-improve-log.ts'

/**
 * Per-owner token cost of the tool schemas and fixed instructions one Session request carries, read from its
 * last `request/header`. Tokens use DSH TokenMeter's fixed density (characters / 4), as the context breakdown does.
 *
 *   node scripts/tool-schema-cost.ts <session.v4.jsonl.zstd | .jsonl> [--json | --capture <out.json>]
 *
 * `--capture` writes the request's full tool schemas and instruction texts as `{ tools, instructions }`, the catalog
 * tool-search's real-model evaluation (`plugins/@dshfiles/tool-search/src/cache-eval.test.ts`) replays.
 */

const toolSchema = Schema.Struct({ name: Schema.String, description: Schema.optionalKey(Schema.String), parameters: Schema.Unknown })
const headerSchema = Schema.Struct({ header: Schema.Struct({ tools: Schema.Array(toolSchema) }) })
const messageSchema = Schema.Struct({
  content: Schema.Array(Schema.Struct({ text: Schema.optionalKey(Schema.String) })),
  source: Schema.optionalKey(Schema.Struct({ kind: Schema.String })),
})
const decodeHeader = Schema.decodeUnknownOption(headerSchema)
/** `system/message` wraps the message in `data.message`; `user/message` carries it as `data`. */
const decodeSystemMessage = Schema.decodeUnknownOption(Schema.Struct({ message: messageSchema }))
const decodeUserMessage = Schema.decodeUnknownOption(messageSchema)

const tokens = (text: string): number => Math.ceil(text.length / 4)

const sourceFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async entry => {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) return []
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(path)
      return /\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [path] : []
    }),
  )
  return nested.flat()
}

const pluginSources = async (): Promise<readonly { readonly plugin: string; readonly text: string }[]> => {
  const root = join(import.meta.dirname, '../plugins/@dshfiles')
  const plugins = await readdir(root)
  return Promise.all(
    plugins.map(async plugin => {
      const files = await sourceFiles(join(root, plugin, 'src'))
      const texts = await Promise.all(files.map(file => readFile(file, 'utf8')))
      return { plugin, text: texts.join('\n') }
    }),
  )
}

/** A name one or two owned plugins quote is theirs; a name many quote is a native tool they only mention. */
const ownerOf = (name: string, sources: readonly { readonly plugin: string; readonly text: string }[]): string => {
  const literal = new RegExp(`['"\`]${name}['"\`]`)
  const hits = sources.filter(source => literal.test(source.text)).map(source => source.plugin)
  if (hits.length === 1 || hits.length === 2) return hits.join('+')
  return name.startsWith('mcp__') ? 'mcp' : 'core/native'
}

const [logPath, flag, capturePath] = process.argv.slice(2)
if (logPath === undefined) {
  console.error('Usage: node scripts/tool-schema-cost.ts <session log (.jsonl or .jsonl.zstd)> [--json]')
  process.exit(1)
}

let tools: readonly (typeof toolSchema.Type)[] | undefined
const instructions: { kind: string; tokens: number }[] = []
const instructionTexts: { kind: string; text: string }[] = []
for await (const record of SessionLogs.stream(logPath)) {
  if (record.type === 'request/header') {
    const header = decodeHeader(record.data)
    if (header._tag === 'Some') tools = header.value.header.tools
    continue
  }
  if (record.type !== 'system/message' && record.type !== 'user/message') continue
  if (tools !== undefined) continue
  const decoded = record.type === 'system/message' ? decodeSystemMessage(record.data) : decodeUserMessage(record.data)
  if (decoded._tag === 'None') continue
  const message = 'message' in decoded.value ? decoded.value.message : decoded.value
  const kind = record.type === 'system/message' ? 'system-prompt' : (message.source?.kind ?? 'user')
  if (kind === 'user') continue
  const text = message.content.map(block => block.text ?? '').join('')
  instructions.push({ kind, tokens: tokens(text) })
  instructionTexts.push({ kind, text })
}
if (tools === undefined) {
  console.error('No request/header in this log: the Session has not sent a model request yet. Send one, then rerun.')
  process.exit(1)
}

const sources = await pluginSources()
const owners = new Map<string, { owner: string; tools: number; tokens: number; descriptionTokens: number }>()
for (const tool of tools) {
  const owner = ownerOf(tool.name, sources)
  const row = owners.get(owner) ?? { owner, tools: 0, tokens: 0, descriptionTokens: 0 }
  row.tools += 1
  row.tokens += tokens(JSON.stringify(tool))
  row.descriptionTokens += tokens(tool.description ?? '')
  owners.set(owner, row)
}
const serialized = JSON.stringify(tools)
const report = {
  tools: tools.length,
  toolBytes: serialized.length,
  toolTokens: tokens(serialized),
  instructions,
  owners: [...owners.values()].sort((left, right) => right.tokens - left.tokens),
}
if (flag === '--capture') {
  if (capturePath === undefined) throw new Error('--capture needs an output path.')
  await writeFile(capturePath, JSON.stringify({ tools, instructions: instructionTexts }))
  console.log(`captured ${String(report.tools)} tools and ${String(instructionTexts.length)} instruction messages to ${capturePath}`)
} else if (flag === '--json') {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`tools ${String(report.tools)}  bytes ${String(report.toolBytes)}  tokens ${String(report.toolTokens)}`)
  for (const item of instructions) console.log(`instructions ${item.kind}: ${String(item.tokens)}`)
  for (const row of report.owners) console.log(`${String(row.tokens).padStart(6)} ${String(row.tools).padStart(4)} ${row.owner}`)
}
