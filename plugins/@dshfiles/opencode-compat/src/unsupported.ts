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

export const unsupportedDomain = (input: {
  pluginId: string
  domain: string
  onUnsupported: 'report' | 'fail'
  records: UnsupportedRecord[]
  register: (registration: Registration) => Registration
}): unknown => {
  const member = (path: string): unknown =>
    new Proxy(
      () => {
        const api = `ctx.${path}`
        const prior = input.records.find(record => record.api === api)
        if (prior === undefined) input.records.push({ pluginId: input.pluginId, api, firstSeenAt: new Date().toISOString(), count: 1 })
        else prior.count += 1
        if (input.onUnsupported === 'fail') throw new OpenCodeUnsupportedError(api)
        if (/\.(transform|hook|subscribe)$/.test(path)) return Promise.resolve(input.register({ dispose: async () => undefined }))
        return Promise.reject(new OpenCodeUnsupportedError(api))
      },
      {
        get: (_target, key) => (key === 'then' || typeof key !== 'string' ? undefined : member(`${path}.${key}`)),
      },
    )
  return new Proxy(
    {},
    {
      get: (_target, key) => (key === 'then' || typeof key !== 'string' ? undefined : member(`${input.domain}.${key}`)),
    },
  )
}
