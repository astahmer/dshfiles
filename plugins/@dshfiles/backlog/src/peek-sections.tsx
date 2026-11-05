import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { CheckIcon, PlusIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'

import type { BacklogDetailView } from './api.js'
import { BacklogItems, type BacklogCriterion } from './item.js'
import { BacklogNotices } from './notices.js'
import { useBacklogActions, type BacklogUpdateInput } from './use-backlog-actions.js'

const inputClass =
  'dshx:h-8 dshx:min-w-0 dshx:flex-1 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-xs dshx:outline-none dshx:focus-visible:border-ring'

const Heading = (props: { readonly title: string; readonly children?: JSX.Element | null }): JSX.Element => (
  <div className="dshx:flex dshx:h-6 dshx:items-center dshx:gap-2">
    <h4 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">{props.title}</h4>
    {props.children}
  </div>
)

const useSave = () => {
  const actions = useBacklogActions()
  return (input: BacklogUpdateInput, failure: string) => actions.update.mutate(input, { onError: BacklogNotices.failure(failure) })
}

/** The acceptance checklist: each criterion checks off on its own, and the heading rolls them up. */
const Criteria = (props: { readonly id: number; readonly criteria: readonly BacklogCriterion[] }): JSX.Element => {
  const save = useSave()
  const [draft, setDraft] = useState('')
  const rollup = BacklogItems.criteriaRollup(props.criteria)
  const replace = (criteria: readonly { readonly id?: string; readonly text: string; readonly done: boolean }[]) =>
    save({ id: props.id, criteria: criteria.length === 0 ? null : criteria }, 'The criteria were not saved.')
  return (
    <section aria-label="Acceptance criteria" className="dshx:flex dshx:flex-col dshx:gap-1.5">
      <Heading title="Acceptance criteria">
        {rollup.total === 0 ? null : (
          <>
            <span className="dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">
              {rollup.done}/{rollup.total}
            </span>
            <Progress value={(rollup.done / rollup.total) * 100} className="dshx:h-1 dshx:w-20" />
          </>
        )}
      </Heading>
      {props.criteria.length === 0 ? null : (
        <ul className="dshx:flex dshx:flex-col dshx:gap-0.5">
          {props.criteria.map(criterion => (
            <li key={criterion.id} className="dshx:group/criterion dshx:flex dshx:min-h-7 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1 dshx:hover:bg-accent/40">
              <Checkbox
                aria-label={criterion.text}
                checked={criterion.done}
                onCheckedChange={checked =>
                  save({ id: props.id, criteriaChecks: [{ id: criterion.id, done: checked === true }] }, 'The criterion was not updated.')
                }
              />
              <span className={criterion.done ? 'dshx:min-w-0 dshx:flex-1 dshx:text-[13px] dshx:text-muted-foreground dshx:line-through' : 'dshx:min-w-0 dshx:flex-1 dshx:text-[13px]'}>
                {criterion.text}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove criterion ${criterion.text}`}
                className="dshx:opacity-0 dshx:group-hover/criterion:opacity-100 dshx:focus-visible:opacity-100"
                onClick={() => replace(props.criteria.filter(other => other.id !== criterion.id))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="dshx:flex dshx:items-center dshx:gap-1.5"
        onSubmit={event => {
          event.preventDefault()
          const added = BacklogItems.criteriaFromText(draft)
          if (added.length === 0) return
          replace([...props.criteria, ...added.map(criterion => ({ text: criterion.text, done: criterion.done }))])
          setDraft('')
        }}
      >
        <input aria-label="New criterion" placeholder="Add a criterion" className={inputClass} value={draft} onChange={event => setDraft(event.currentTarget.value)} />
        <Button type="submit" size="icon-xs" variant="ghost" aria-label="Add criterion" disabled={draft.trim() === ''}>
          <PlusIcon />
        </Button>
      </form>
    </section>
  )
}

/** A markdown section edited in place: the draft saves on blur, and an empty draft removes the section. */
const SectionText = (props: { readonly label: string; readonly value: string; readonly placeholder: string; readonly save: (text: string) => void }): JSX.Element => {
  const [draft, setDraft] = useState(props.value)
  const [seen, setSeen] = useState(props.value)
  if (seen !== props.value) {
    setSeen(props.value)
    setDraft(props.value)
  }
  return (
    <Textarea
      aria-label={props.label}
      placeholder={props.placeholder}
      value={draft}
      rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
      className="dshx:text-[13px]"
      onChange={event => setDraft(event.currentTarget.value)}
      onBlur={() => {
        if (draft !== props.value) props.save(draft)
      }}
    />
  )
}

/** The plan, with the approval it may wait on: an agent asks, only you approve. */
const Plan = (props: { readonly detail: BacklogDetailView }): JSX.Element => {
  const save = useSave()
  const item = props.detail.item
  const [open, setOpen] = useState(false)
  if (item.plan === undefined && !open)
    return (
      <Heading title="Plan">
        <Button size="xs" variant="ghost" className="dshx:ml-auto" onClick={() => setOpen(true)}>
          <PlusIcon /> Plan
        </Button>
      </Heading>
    )
  return (
    <section aria-label="Plan" className="dshx:flex dshx:flex-col dshx:gap-1.5">
      <Heading title="Plan">
        {item.planApproval === 'pending' ? (
          <>
            <span className="dshx:rounded-full dshx:bg-warning/15 dshx:px-1.5 dshx:text-[11px] dshx:text-warning">Waiting for your approval</span>
            <Button
              size="xs"
              variant="outline"
              className="dshx:ml-auto"
              onClick={() => save({ id: item.id, planApproval: 'approved' }, 'The plan was not approved.')}
            >
              <CheckIcon /> Approve plan
            </Button>
          </>
        ) : item.planApproval === 'approved' ? (
          <span className="dshx:rounded-full dshx:bg-success/15 dshx:px-1.5 dshx:text-[11px] dshx:text-success">Approved</span>
        ) : null}
      </Heading>
      <SectionText
        label="Plan"
        value={item.plan ?? ''}
        placeholder="How the work will be done"
        save={plan => save({ id: item.id, plan: plan.trim() === '' ? null : plan }, 'The plan was not saved.')}
      />
    </section>
  )
}

/** What was done, written when the item closes; Shipped shows it. */
const Summary = (props: { readonly detail: BacklogDetailView }): JSX.Element | null => {
  const save = useSave()
  const item = props.detail.item
  const closed = item.status === 'done' || item.status === 'dropped'
  const [open, setOpen] = useState(false)
  if (item.summary === undefined && !closed && !open)
    return (
      <Heading title="Summary">
        <Button size="xs" variant="ghost" className="dshx:ml-auto" onClick={() => setOpen(true)}>
          <PlusIcon /> Summary
        </Button>
      </Heading>
    )
  return (
    <section aria-label="Summary" className="dshx:flex dshx:flex-col dshx:gap-1.5">
      <Heading title="Summary" />
      <SectionText
        label="Summary"
        value={item.summary ?? ''}
        placeholder="What shipped, for the Shipped view"
        save={summary => save({ id: item.id, summary: summary.trim() === '' ? null : summary }, 'The summary was not saved.')}
      />
    </section>
  )
}

/** Acceptance criteria, plan and final summary: structured fields of their own, never parsed out of the body. */
const Sections = (props: { readonly detail: BacklogDetailView }): JSX.Element => (
  <div className="dshx:flex dshx:flex-col dshx:gap-4">
    <Criteria id={props.detail.item.id} criteria={props.detail.item.criteria ?? []} />
    <Plan detail={props.detail} />
    <Summary detail={props.detail} />
  </div>
)

export class PeekSections {
  static readonly Sections = Sections
}
