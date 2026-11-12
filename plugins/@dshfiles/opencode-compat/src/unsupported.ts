// OpenCode MIT: packages/plugin/src/promise/registration.ts, commit 67139d6827af.
export interface Registration {
  readonly dispose: () => Promise<void>
}

export interface UnsupportedRecord {
  readonly pluginId: string
  readonly api: string
  readonly firstSeenAt: string
  count: number
}

export class OpenCodeUnsupportedError extends Error {
  constructor(api: string) {
    super(`${api} is unsupported. See the Unsupported section of the @dshfiles/opencode-compat README.`)
    this.name = 'OpenCodeUnsupportedError'
  }
}

interface RecorderInput {
  readonly pluginId: string
  readonly onUnsupported: 'report' | 'fail'
  readonly records: UnsupportedRecord[]
  readonly register: (registration: Registration) => Registration
}

export const unsupportedMember = (input: RecorderInput & { readonly path: string }) =>
  new Proxy(
    (..._args: unknown[]): unknown => {
      const api = `ctx.${input.path}`
      const prior = input.records.find(record => record.api === api)
      if (prior === undefined) input.records.push({ pluginId: input.pluginId, api, firstSeenAt: new Date().toISOString(), count: 1 })
      else prior.count += 1
      if (input.onUnsupported === 'fail') throw new OpenCodeUnsupportedError(api)
      if (/\.(transform|hook|subscribe)$/.test(input.path)) return Promise.resolve(input.register({ dispose: async () => undefined }))
      return Promise.reject(new OpenCodeUnsupportedError(api))
    },
    {
      get: (_target, key) => (key === 'then' || typeof key !== 'string' ? undefined : unsupportedMember({ ...input, path: `${input.path}.${key}` })),
    },
  )

export const unsupportedDomain = (input: RecorderInput & { readonly domain: string }): unknown =>
  new Proxy(
    {},
    {
      get: (_target, key) => (key === 'then' || typeof key !== 'string' ? undefined : unsupportedMember({ ...input, path: `${input.domain}.${key}` })),
    },
  )
