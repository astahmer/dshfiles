import * as Schema from 'effect/Schema'
import { dshxRegistryApi, pluginToolCatalog } from '../api/index.js'
import { jsonValueSchema } from '../json.js'
import { DshPlatformError } from '../platform/client.js'
import { connectDshxApi, createDshxApiCaller } from '../platform/dshx-api.js'
import { connectDshxApiClient } from '../platform/dshx-api-client.js'
import type { CliArgs } from './args.js'
import type { CliIO } from './run.js'

export const runToolsCli = async ({
  args,
  io,
  origin,
  fetch: request,
}: {
  readonly args: CliArgs
  readonly io: CliIO
  readonly origin?: string
  readonly fetch?: typeof fetch
}): Promise<number> => {
  try {
    const options = {
      ...(args.url !== undefined && { url: args.url }),
      ...(origin !== undefined && { origin }),
      ...(request !== undefined && { fetch: request }),
    }
    const registry = await connectDshxApiClient(dshxRegistryApi, options)
    const [action, name] = args.platformArgs ?? []
    const catalog = pluginToolCatalog({ listing: await registry.list(args.owner === undefined ? {} : { owner: args.owner }) })
    if (action === 'list') {
      const entries = catalog
        .filter(entry => args.owner === undefined || entry.owner === args.owner)
        .map(entry => ({
          name: entry.name,
          description: entry.description,
          readOnly: entry.readOnly,
          owner: entry.owner,
          apiId: entry.apiId,
          version: entry.version,
          method: entry.method,
        }))
      io.stdout.write(
        args.json
          ? `${JSON.stringify(entries, null, 2)}\n`
          : `${entries.map(entry => `${entry.name}\t${entry.readOnly ? 'read' : 'write'}\t${entry.owner}\t${entry.description.split(/(?<=\.)\s/)[0]}`).join('\n')}\n`,
      )
      return 0
    }
    const match = catalog.find(item => item.name === name)
    if (match === undefined) {
      io.stderr.write(`error: Unknown tool ${JSON.stringify(name)}. Run dshx tools list to find a tool.\n`)
      return 2
    }
    const entry = pluginToolCatalog({ listing: await registry.list({ owner: match.owner, schemas: true }) }).find(item => item.name === name)
    if (entry === undefined) {
      io.stderr.write(`error: Unknown tool ${JSON.stringify(name)}. Run dshx tools list to find a tool.\n`)
      return 2
    }
    if (action === 'describe') {
      io.stdout.write(`${JSON.stringify(entry, null, 2)}\n`)
      return 0
    }
    if (!entry.readOnly && !args.write) {
      io.stderr.write(`error: ${entry.name} changes state; add --write only when you mean to.\n`)
      return 2
    }
    if (!entry.takesInput && args.input !== undefined) {
      io.stderr.write('error: This tool takes no input; remove --input.\n')
      return 2
    }
    let input
    if (args.input !== undefined) {
      let text = args.input
      if (text === '-') {
        text = ''
        for await (const chunk of io.stdin) text += String(chunk)
      }
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        throw new TypeError('--input must be a JSON object.')
      }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('--input must be a JSON object.')
      input = Schema.decodeUnknownSync(jsonValueSchema)(value)
    }
    const target = { packageId: entry.owner, apiId: entry.apiId, version: entry.version, ...(request !== undefined && { fetch: request }) }
    const call =
      origin === undefined
        ? await connectDshxApi({ ...target, ...(args.url !== undefined && { url: args.url }) })
        : createDshxApiCaller({ ...target, origin, cookie: '' })
    const result = await call(entry.method, input)
    io.stdout.write(`${JSON.stringify(result ?? null, null, 2)}\n`)
    return 0
  } catch (error) {
    const code = error instanceof DshPlatformError ? error.code : 'command-failed'
    const message = (error instanceof Error ? error.message : 'The DSH operation failed.').replace(/token=[^&\s]*/gi, 'token=[redacted]')
    io.stderr.write(`error [${code}]: ${message}\n`)
    return error instanceof TypeError ? 2 : 1
  }
}
