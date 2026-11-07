import { useState } from 'react'
import { Composer, useContract } from '@dshfiles/dshx/client'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { QuoteIcon } from '@dshfiles/plugin-ui/icons'
import type { ChatViewSlotProps } from './native/contract/slots.ts'
import { insertMessageQuote, selectedMessageText, type MessageQuoteSource } from './quote-message.ts'

export const QuoteMessageAction = (props: {
  readonly source: MessageQuoteSource
  readonly text: string
  readonly className: string | undefined
  readonly t: ChatViewSlotProps['t']
}) => {
  const composer = useContract(Composer)
  const [failed, setFailed] = useState(false)
  if (composer.status !== 'active' || props.text.trim() === '') return null
  const label = failed ? props.t('message.quoteFailed') : props.t('message.quote')
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        className={props.className}
        aria-label={label}
        onMouseDown={event => event.preventDefault()}
        onClick={event => {
          const text = selectedMessageText({ button: event.currentTarget, source: props.source, selection: window.getSelection() }) ?? props.text
          setFailed(
            !insertMessageQuote({
              composer: composer.value,
              source: props.source,
              text,
              attribution: props.t('message.quoteSource', {
                role: props.t(props.source.role === 'user' ? 'message.quoteUser' : 'message.quoteAssistant'),
                sessionId: props.source.sessionId,
                seq: props.source.seq,
              }),
            }),
          )
        }}
      >
        <QuoteIcon width={16} height={16} />
      </button>
    </Tooltip>
  )
}
