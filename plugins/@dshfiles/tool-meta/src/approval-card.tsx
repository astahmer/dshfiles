import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { ShieldAlertIcon, ShieldCheckIcon, ShieldIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { Option, Schema } from 'effect'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ApprovalRisk, type ApprovalRiskLevel } from './approval-risk.js'
import type { ToolMetaTranslate } from './locales.js'

/** A running tool call whose arguments carry a shell command; any other node decodes to nothing. */
const decodeShellCall = Schema.decodeUnknownOption(
  Schema.Struct({
    root: Schema.Struct({
      callId: Schema.String,
      phase: Schema.Literal('start'),
      kind: Schema.optional(Schema.Unknown),
      argsRaw: Schema.fromJsonString(Schema.Struct({ command: Schema.String })),
    }),
  }),
)

/**
 * An approval is Needs you whatever its risk (b:ysaj): the card keeps a neutral frame and leads with the indigo
 * diamond, and the risk is a small badge on the status trio, red only for a destructive command.
 */
const RISK = {
  high: {
    badge: 'outline',
    label: 'riskHigh',
    Icon: ShieldAlertIcon,
    tone: 'dshx:border-(--dshx-tone-danger-border) dshx:bg-(--dshx-tone-danger-bg) dshx:text-destructive',
  },
  review: { badge: 'outline', label: 'riskReview', Icon: ShieldIcon, tone: 'dshx:text-muted-foreground' },
  low: { badge: 'muted', label: 'riskLow', Icon: ShieldCheckIcon, tone: '' },
} as const satisfies Record<ApprovalRiskLevel, { readonly badge: string; readonly label: string; readonly Icon: unknown; readonly tone: string }>

/**
 * The native approval request, restyled: the risk the request carries, the tool and its command, and the native keys
 * (with focus on the details, Enter allows once and Escape rejects). The decision still goes through the native
 * request's `answer`, so its waterfall, withdrawal and one-answer lock stay the approval package's.
 */
export const ApprovalCard = (
  props: PropsRuntime<'conversation.composer'> & {
    readonly matched: PendingApproval
    readonly reason: string
    readonly t: ToolMetaTranslate
  },
): JSX.Element => <AnsweringCard key={props.matched.key} {...props} />

/** One request's answering state, mounted per `key`: the next request starts unlocked, like the native panel. */
const AnsweringCard = (
  props: PropsRuntime<'conversation.composer'> & {
    readonly matched: PendingApproval
    readonly reason: string
    readonly t: ToolMetaTranslate
  },
): JSX.Element => {
  const approval = props.matched
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const locked = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const command = props.useChat(snapshot => {
    for (const node of snapshot.nodes.values()) {
      if (node.kind !== 'tool-call') continue
      const call = decodeShellCall(node.data)
      if (Option.isSome(call) && call.value.root.callId === approval.callId && call.value.root.kind === undefined) return call.value.root.argsRaw.command
    }
    return undefined
  })
  const risk = RISK[ApprovalRisk.assess({ toolName: approval.toolName, command })]

  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    if (locked.current || !approval.answerable) return
    locked.current = true
    setSending(true)
    setFailure(undefined)
    approval.answer(outcome).catch((error: unknown) => {
      locked.current = false
      if (!mounted.current) return
      setSending(false)
      setFailure(errorMessage(error, props.t('approvalFailed')))
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    if (
      event.target !== event.currentTarget ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.repeat ||
      event.nativeEvent.isComposing
    )
      return
    event.preventDefault()
    event.stopPropagation()
    answer(event.key === 'Enter' ? 'allowed-once' : 'rejected')
  }

  return (
    <div
      className="dshx-root dshx:@container dshx:flex dshx:w-full dshx:flex-col dshx:items-center dshx:px-4 dshx:pt-2 dshx:pb-3"
      data-approval-card={approval.key}
      aria-busy={sending}
    >
      <div className="dshx:w-full dshx:max-w-3xl dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-background dshx:shadow-s1">
        <div
          aria-label={props.t('approvalDetails')}
          className="dshx:flex dshx:max-h-72 dshx:flex-col dshx:gap-2 dshx:overflow-y-auto dshx:px-4 dshx:pt-3 dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
          onKeyDown={onKeyDown}
          role="group"
          tabIndex={0}
        >
          <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
            <StatusGlyph status="needs-you" label={props.t('approvalNeedsYou')} />
            <span className="dshx:shrink-0 dshx:text-xs dshx:font-medium dshx:text-foreground">{props.t('approvalNeedsYou')}</span>
            <Badge className={risk.tone} data-approval-risk={risk.label} variant={risk.badge}>
              <risk.Icon aria-hidden />
              {props.t(risk.label)}
            </Badge>
            <code className="dshx:min-w-0 dshx:truncate dshx:font-mono! dshx:text-xs dshx:text-muted-foreground">{approval.toolName}</code>
          </div>
          <div className="dshx:text-sm dshx:font-medium dshx:text-foreground">{props.reason}</div>
          {command === undefined ? null : (
            <pre
              className="dshx:max-h-40 dshx:overflow-auto dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted dshx:px-3 dshx:py-2 dshx:font-mono! dshx:text-xs dshx:whitespace-pre-wrap dshx:break-all"
              data-approval-command=""
            >
              {command}
            </pre>
          )}
          {failure === undefined ? null : (
            <div className="dshx:text-xs dshx:text-destructive" role="alert">
              {failure}
            </div>
          )}
        </div>
        {/* ≥48pt on a phone, side by side across the card (b:ysaj). */}
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-end dshx:gap-2 dshx:px-4 dshx:py-3 dshx:@max-pane-narrow:flex-nowrap">
          <Button
            className="dshx:pointer-coarse:h-12 dshx:@max-pane-narrow:flex-1"
            disabled={sending}
            onClick={() => answer('rejected')}
            size="sm"
            type="button"
            variant="outline"
          >
            {props.t('approvalReject')}
            <Kbd className="dshx:bg-transparent dshx:text-current dshx:opacity-70 dshx:@max-pane-narrow:hidden">Esc</Kbd>
          </Button>
          <Button
            className="dshx:pointer-coarse:h-12 dshx:@max-pane-narrow:flex-1"
            disabled={sending}
            onClick={() => answer('allowed-once')}
            size="sm"
            type="button"
            variant={risk.label === 'riskHigh' ? 'destructive' : 'default'}
          >
            {props.t('approvalAllowOnce')}
            <Kbd className="dshx:bg-transparent dshx:text-current dshx:opacity-70 dshx:@max-pane-narrow:hidden">↵</Kbd>
          </Button>
        </div>
      </div>
    </div>
  )
}
