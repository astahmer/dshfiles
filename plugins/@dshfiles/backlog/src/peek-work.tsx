import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { CornerLeftUpIcon, LockOpenIcon, PlusIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'

import type { BacklogDetailView, BacklogSummaryView } from './api.js'
import { BacklogReference } from './backlog-reference.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogNotices } from './notices.js'
import { useBacklogActions } from './use-backlog-actions.js'
import { WorkGlyphs } from './work-glyphs.js'

const fieldClass =
  'dshx:h-8 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-xs dshx:outline-none dshx:focus-visible:border-ring'

/** A one-field popover form: type, Enter submits and closes. */
const QuickField = (props: {
  readonly label: string
  readonly placeholder: string
  readonly trigger: JSX.Element
  readonly submit: (text: string) => void
}): JSX.Element => {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{props.trigger}</PopoverTrigger>
      <PopoverContent align="end" className="dshx-root dshx:w-80 dshx:p-2">
        <form
          onSubmit={event => {
            event.preventDefault()
            if (text.trim() === '') return
            props.submit(text.trim())
            setText('')
            setOpen(false)
          }}
        >
          <input
            aria-label={props.label}
            autoFocus
            placeholder={props.placeholder}
            className={`${fieldClass} dshx:w-full`}
            value={text}
            onChange={event => setText(event.currentTarget.value)}
          />
        </form>
      </PopoverContent>
    </Popover>
  )
}

/** Who owns the item, who works on it for them, and the claim that agent holds, with the Release action. */
const WorkLine = (props: { readonly detail: BacklogDetailView; readonly select: (id: number) => void }): JSX.Element | null => {
  const actions = useBacklogActions()
  const item = props.detail.item
  const owner = item.actors.find(actor => actor.role === 'owner')?.id ?? 'user'
  const run = WorkGlyphs.useRunState({ status: item.status, delegate: item.delegate ?? null, links: item.links })
  const parent = props.detail.parentItem
  return (
    <div aria-label="Ownership" className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
      <span className="dshx:inline-flex dshx:items-center dshx:gap-1">
        <ItemGlyphs.ActorAvatar actorId={owner} />
        <span>Owner</span>
        <span className="dshx:text-foreground">{ItemGlyphs.actorName(owner)}</span>
      </span>
      {item.delegate === undefined ? null : (
        <>
          <span aria-hidden>·</span>
          <span className="dshx:inline-flex dshx:items-center dshx:gap-1">
            <ItemGlyphs.ActorAvatar actorId={item.delegate} />
            <span>Delegate</span>
            <span className="dshx:max-w-40 dshx:truncate dshx:text-foreground">{ItemGlyphs.actorName(item.delegate)}</span>
          </span>
        </>
      )}
      <WorkGlyphs.RunStateChip run={run} />
      <WorkGlyphs.ClaimChip lease={props.detail.lease} />
      {props.detail.lease === null ? null : (
        <Button
          size="xs"
          variant="ghost"
          disabled={actions.release.isPending}
          onClick={() => actions.release.mutate(item.id, { onError: BacklogNotices.failure('The claim was not released.') })}
        >
          <LockOpenIcon /> Release
        </Button>
      )}
      <WorkGlyphs.BlockedBadge blockedBy={props.detail.blockedBy.map(blocker => BacklogReference.refOf(blocker))} />
      <span className="dshx:ml-auto dshx:inline-flex dshx:items-center dshx:gap-1">
        {parent === null ? (
          <QuickField
            label="Parent item"
            placeholder="b:k3f9 — nest this item under it"
            submit={text => actions.update.mutate({ id: item.id, parent: text }, { onError: BacklogNotices.failure('The parent was not set.') })}
            trigger={
              <Button size="xs" variant="ghost" aria-label="Set parent">
                <CornerLeftUpIcon /> Set parent
              </Button>
            }
          />
        ) : (
          <>
            <button
              type="button"
              aria-label={`Parent ${BacklogReference.labelOf(parent)}`}
              onClick={() => props.select(parent.id)}
              className="dshx:inline-flex dshx:max-w-56 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:px-1.5 dshx:py-0.5 dshx:hover:bg-accent dshx:hover:text-foreground"
            >
              <CornerLeftUpIcon aria-hidden className="dshx:size-3" />
              <span className="dshx:font-mono!">{BacklogReference.labelOf(parent)}</span>
              <span className="dshx:truncate">{parent.title}</span>
            </button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Remove parent"
              onClick={() => actions.update.mutate({ id: item.id, parent: null }, { onError: BacklogNotices.failure('The parent was not removed.') })}
            >
              <XIcon />
            </Button>
          </>
        )}
      </span>
    </div>
  )
}

const ChildRow = (props: { readonly child: BacklogSummaryView; readonly select: (id: number) => void }): JSX.Element => {
  const child = props.child
  const run = WorkGlyphs.useRunState(child)
  return (
    <li>
      <button
        type="button"
        onClick={() => props.select(child.id)}
        className="dshx:flex dshx:h-8 dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:text-left dshx:text-[13px] dshx:transition-colors dshx:hover:bg-accent/50"
      >
        <WorkGlyphs.PriorityIcon priority={child.priority} />
        <ItemGlyphs.StatusIcon status={child.status} />
        <span className="dshx:font-mono! dshx:text-xs dshx:text-muted-foreground">{BacklogReference.labelOf(child)}</span>
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{child.title}</span>
        <WorkGlyphs.ProgressBadge progress={child.children} />
        <WorkGlyphs.ClaimChip lease={child.lease} compact />
        <WorkGlyphs.RunStateChip run={run} compact />
      </button>
    </li>
  )
}

/** Sub-issues with their roll-up, and the capture that adds one under this item. */
const SubIssues = (props: { readonly detail: BacklogDetailView; readonly select: (id: number) => void }): JSX.Element | null => {
  const actions = useBacklogActions()
  const item = props.detail.item
  const children = props.detail.children
  const counted = children.filter(child => child.status !== 'dropped')
  const done = counted.filter(child => child.status === 'done').length
  const addSubIssue = (
    <QuickField
      label="Sub-issue title"
      placeholder="New sub-issue — !1…!4 sets its priority"
      submit={text =>
        actions.capture.mutate(
          { text, parent: BacklogReference.refOf(item), project: item.project },
          { onError: BacklogNotices.failure('The sub-issue was not added.') },
        )
      }
      trigger={
        <Button size="xs" variant="ghost" aria-label="Add sub-issue">
          <PlusIcon /> Sub-issue
        </Button>
      }
    />
  )
  return (
    <section aria-label="Sub-issues" className="dshx:flex dshx:flex-col dshx:gap-2">
      <div className="dshx:flex dshx:h-6 dshx:items-center dshx:gap-2">
        <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">Sub-issues</h4>
        {counted.length === 0 ? null : (
          <>
            <span className="dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">
              {done}/{counted.length} done
            </span>
            <Progress value={(done / counted.length) * 100} className="dshx:h-1 dshx:w-20" />
          </>
        )}
        <span className="dshx:ml-auto">{addSubIssue}</span>
      </div>
      {children.length === 0 ? null : (
        <ul aria-label="Sub-issue list" className="dshx:flex dshx:flex-col">
          {children.map(child => (
            <ChildRow key={child.id} child={child} select={props.select} />
          ))}
        </ul>
      )}
    </section>
  )
}

export class PeekWork {
  static readonly WorkLine = WorkLine
  static readonly SubIssues = SubIssues
}
