export type CacheRetention = 'short' | 'long'

export const cacheRetentionFor = (input: {
  readonly provider: string
  readonly model: string
  readonly settings: Readonly<Record<string, CacheRetention>>
}): CacheRetention | undefined => input.settings[`${input.provider}/${input.model}`] ?? input.settings[`${input.provider}/*`]
