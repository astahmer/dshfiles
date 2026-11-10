import { Fragment, memo } from 'react'
import { IconSparkleRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { routeChangeParts } from '../conversation-nodes/route-change.ts'
import css from './RouteChangeRow.module.css'

/** Route-change keyed Chat renderer: `model a → b · effort high → low`, the full routes in the accessible name. */
export const RouteChangeNodeView = memo(function RouteChangeNodeView({ node, t }: Pick<ChatNodeViewProps<'route-change'>, 'node' | 't'>) {
  const { from, to } = node.data
  const parts = routeChangeParts(from, to)
  const label = parts.map(part => `${t(`routeChange.${part.field}`)} ${part.from} → ${part.to}`).join(' · ')
  return (
    <div className={css.root} data-chat-route-change="" role="note" aria-label={label}>
      <IconSparkleRegular size={14} className={css.icon} />
      <span className={css.text}>
        {parts.map((part, index) => (
          <Fragment key={part.field}>
            {index > 0 && ' · '}
            {t(`routeChange.${part.field}`)} {part.from} → <span className={css.value}>{part.to}</span>
          </Fragment>
        ))}
      </span>
    </div>
  )
})
