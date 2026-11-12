import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { withSpan } from '@dshfiles/dshx/tracing'
import { Schema } from 'effect'
import type { DomainInput } from '../context.js'

const valueSchema = Schema.Struct({ value: Schema.Json })

export const storageDomain = (config: { readonly ctx: Context; readonly input: DomainInput }) => {
  const name = `opencode_${createHash('sha256').update(config.input.pluginId).digest('hex')}`
  const spec = defineDomain({ name, version: 1, tables: { values: { valueSchema: zodSchemaFromEffect(valueSchema), __key: 'values' } } })
  let opened: ReturnType<typeof config.ctx.storageDomain.open<typeof spec>> | undefined
  const open = () => {
    if (opened === undefined) {
      if (config.ctx.get('storageDomain') === undefined)
        throw new Error('DSH storageDomain service is unavailable. Enable Host storage and reload this plugin.')
      opened = new Promise((resolve, reject) => {
        const fiber = config.ctx.inject(['storageDomain'], scoped => {
          void scoped.storageDomain.open(spec).then(resolve, reject)
        })
        config.input.register({
          dispose: async () => {
            try {
              await (await opened)?.close()
            } finally {
              await fiber.dispose()
            }
          },
        })
      })
    }
    return opened
  }
  const operation = <A>(name: string, run: () => Promise<A>) => withSpan(name, {}, () => run())
  return {
    get: (key: string) => operation('opencode-storage get', async () => (await open()).table('values').get(key)?.value),
    set: (key: string, value: unknown) =>
      operation('opencode-storage set', async () => {
        await (await open()).table('values').put(key, { value: Schema.decodeUnknownSync(Schema.Json)(value) })
      }),
    remove: (key: string) =>
      operation('opencode-storage remove', async () => {
        await (await open()).table('values').delete(key)
      }),
    scan: (options: { prefix: string; after?: string; limit?: number }) =>
      operation('opencode-storage scan', async () => {
        const entries = [...(await open()).table('values').entries()]
          .filter(([key]) => key.startsWith(options.prefix) && (options.after === undefined || key > options.after))
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        const selected = entries.slice(0, options.limit)
        const next = selected.length < entries.length ? selected.at(-1)?.[0] : undefined
        return { entries: selected.map(([key, entry]) => ({ key, value: entry.value })), ...(next === undefined ? {} : { next }) }
      }),
  }
}
