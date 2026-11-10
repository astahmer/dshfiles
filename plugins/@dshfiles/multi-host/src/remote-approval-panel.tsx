import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { Option, Schema } from 'effect'
import type { PendingRemoteApproval, RemoteApprovalOutcome } from './remote-approvals.js'

/** A running tool call whose arguments carry a shell command; any other node decodes to nothing and shows no command. */
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

const reasonOf = (approval: PendingRemoteApproval): string =>
  approval.displayReason?.en ?? approval.reason ?? `The tool ${approval.toolName} asks to run with more access.`

/**
 * The native approval panel's flow for a request another machine holds: the same keys (Enter allows, Escape rejects,
 * only with focus on the details), and one lock across keys and pointer. The host decides, so a refusal keeps the panel.
 */
export const RemoteApprovalPanel = (props: PropsRuntime<'conversation.composer'> & { readonly matched: PendingRemoteApproval }) => {
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

  const answer = (outcome: RemoteApprovalOutcome): void => {
    if (locked.current) return
    locked.current = true
    setSending(true)
    setFailure(undefined)
    approval.answer(outcome).catch((error: unknown) => {
      locked.current = false
      if (!mounted.current) return
      setSending(false)
      setFailure(errorMessage(error, 'The host did not take this decision. Check the thread, then try again.'))
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return
    event.preventDefault()
    event.stopPropagation()
    answer(event.key === 'Enter' ? 'allowed-once' : 'rejected')
  }

  return (
    <div
      className="dshx-root dshx:flex dshx:w-full dshx:flex-col dshx:items-center dshx:px-4 dshx:pb-3 dshx:pt-2"
      data-remote-approval={approval.key}
      aria-busy={sending}
    >
      <div className="dshx:w-full dshx:max-w-3xl dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-warning dshx:bg-background dshx:shadow-md">
        <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:bg-warning/10 dshx:px-4 dshx:py-2.5 dshx:text-sm dshx:text-warning">
          <TriangleAlertIcon className="dshx:size-4" aria-hidden />
          Waiting for approval on the remote host
        </div>
        <div
          className="dshx:flex dshx:max-h-64 dshx:flex-col dshx:gap-1.5 dshx:overflow-y-auto dshx:px-4 dshx:pt-3"
          role="group"
          aria-label="Approval details"
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <div className="dshx:text-sm dshx:font-medium dshx:text-foreground">{reasonOf(approval)}</div>
          {command === undefined ? null : <div className="dshx:font-mono! dshx:text-xs dshx:break-all dshx:text-muted-foreground">{command}</div>}
          {failure === undefined ? null : <div className="dshx:text-xs dshx:text-destructive">{failure}</div>}
        </div>
        <div className="dshx:flex dshx:justify-end dshx:gap-2 dshx:px-4 dshx:py-3">
          <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => answer('rejected')}>
            Reject
          </Button>
          <Button type="button" size="sm" disabled={sending} onClick={() => answer('allowed-once')}>
            Allow once
          </Button>
        </div>
      </div>
    </div>
  )
}
