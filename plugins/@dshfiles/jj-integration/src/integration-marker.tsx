import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import type { JjIntegrationTranslate } from './locales.js'
import { activityLabel } from './relative-label.js'

const SHORT_ID_LENGTH = 8

/**
 * The words and time of one "Landed on …" transcript marker, on one line at any width (round three item 27): where it
 * landed and how long ago. The revision it landed (8 characters) and the exact time are one hover or focus away; the
 * full change id wrapped the phone marker over four lines.
 */
export const IntegrationMarkerLine = (props: {
  readonly t: JjIntegrationTranslate
  readonly bookmark: string
  readonly at: number
  readonly now: number
  readonly tipChangeId: string | undefined
}): JSX.Element => {
  const exact = new Date(props.at).toLocaleString()
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="dshx:min-w-0 dshx:truncate dshx:whitespace-nowrap dshx:rounded-sm dshx:focus-visible:outline-2 dshx:focus-visible:outline-ring"
            data-testid="jj-integration-marker-text"
            tabIndex={0}
          >
            {props.t('rebaseNotice', { bookmark: props.bookmark })}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {props.tipChangeId === undefined ? exact : props.t('rebaseNoticeTip', { revisionId: props.tipChangeId.slice(0, SHORT_ID_LENGTH), at: exact })}
        </TooltipContent>
      </Tooltip>
      <time className="dshx:shrink-0 dshx:whitespace-nowrap dshx:text-xs dshx:tabular-nums" dateTime={new Date(props.at).toISOString()}>
        {activityLabel(props.t, props.at, props.now)}
      </time>
    </>
  )
}
