import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { StalledStream } from './stalled-stream.js'
import { usePreferences } from './use-preferences.js'

const StalledStreamAdvice = (props: { readonly silentMs: number }): JSX.Element => {
  const preferences = usePreferences()
  return (
    <p className="dshx-root dshx:mt-2 dshx:text-sm dshx:text-muted-foreground" role="status">
      {StalledStream.turnAdvice({ silentMs: props.silentMs, fallbackOn: preferences.stalledStreamFallback })}
    </p>
  )
}

export const StalledStreamMessage = (props: { readonly turn: TurnLocation }): JSX.Element | null => {
  const end = props.turn.end
  if (end?.data.reason.kind !== 'error') return null
  const silentMs = StalledStream.silentMs(end.data.reason.error)
  if (silentMs === undefined) return null
  return <StalledStreamAdvice silentMs={silentMs} />
}
