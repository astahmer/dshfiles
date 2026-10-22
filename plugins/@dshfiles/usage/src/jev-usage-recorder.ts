import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import type { JevUsageRecord } from './jev-usage.js'

export const jevSourceOf = (caller: ApiCaller, source: JevUsageRecord['source']): boolean =>
  caller.kind === 'plugin' && caller.packageId === `@dshfiles/${source}`

export const createJevUsageRecorder = (dependencies: {
  readonly authorize: (caller: ApiCaller, source: JevUsageRecord['source']) => boolean
  readonly record: (record: JevUsageRecord) => void
}) => {
  const handler = ({ input, caller }: { readonly input: JevUsageRecord; readonly caller: ApiCaller }) => {
    if (!dependencies.authorize(caller, input.source)) throw new PluginApiError('Only the Jev source plugin may record its own usage.', { code: 'jev-caller' })
    dependencies.record(input)
    return { accepted: true as const }
  }
  return handler
}
