import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { CheckIcon, CircleDotIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestIcon, HourglassIcon, PlusIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState } from 'react'

import { backlogApi, type BacklogDetailView } from './api.js'
import { DueDates } from './due-date.js'
import { BacklogGates, type BacklogGate, type BacklogGateKind } from './gates.js'
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

const gateKindLabels = { pr: 'Pull request merged', revision: 'Revision on main', check: 'Project check passes', date: 'Date reached' } satisfies Record<
  BacklogGateKind,
  string
>
const gatePlaceholders = { pr: 'https://github.com/owner/repo/pull/12', revision: 'jj change id', check: 'project-check action id', date: '2026-12-01' } satisfies Record<
  BacklogGateKind,
  string
>

/** What the item waits on outside the backlog; each gate resolves on its own, a date gate on the calendar. */
const Gates = (props: { readonly id: number; readonly gates: readonly BacklogGate[] }): JSX.Element => {
  const save = useSave()
  const [kind, setKind] = useState<BacklogGateKind>('pr')
  const [target, setTarget] = useState('')
  const today = DueDates.dateOf(Date.now())
  const replace = (gates: readonly { readonly kind: BacklogGateKind; readonly target: string }[]) =>
    save({ id: props.id, gates: gates.length === 0 ? null : gates.map(gate => ({ kind: gate.kind, target: gate.target })) }, 'The gates were not saved.')
  return (
    <section aria-label="Gates" className="dshx:flex dshx:flex-col dshx:gap-1.5">
      <Heading title="Waits on" />
      {props.gates.length === 0 ? null : (
        <ul className="dshx:flex dshx:flex-col dshx:gap-0.5">
          {props.gates.map(gate => {
            const open = BacklogGates.isOpen(gate, today)
            return (
              <li key={gate.id} className="dshx:group/gate dshx:flex dshx:min-h-7 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1 dshx:text-[13px] dshx:hover:bg-accent/40">
                {open ? (
                  <HourglassIcon aria-label="Open" className="dshx:size-3.5 dshx:shrink-0 dshx:text-warning" />
                ) : (
                  <CheckIcon aria-label="Met" className="dshx:size-3.5 dshx:shrink-0 dshx:text-success" />
                )}
                <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate', !open && 'dshx:text-muted-foreground')}>{BacklogGates.label(gate)}</span>
                {gate.detail === undefined ? null : <span className="dshx:shrink-0 dshx:text-[11px] dshx:text-muted-foreground">{gate.detail}</span>}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove gate ${BacklogGates.label(gate)}`}
                  className="dshx:opacity-0 dshx:group-hover/gate:opacity-100 dshx:focus-visible:opacity-100"
                  onClick={() => replace(props.gates.filter(other => other.id !== gate.id))}
                >
                  <XIcon />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <form
        className="dshx:flex dshx:items-center dshx:gap-1.5"
        onSubmit={event => {
          event.preventDefault()
          if (target.trim() === '') return
          replace([...props.gates, { kind, target: target.trim() }])
          setTarget('')
        }}
      >
        <Select value={kind} onValueChange={value => setKind(BacklogGates.kinds.find(candidate => candidate === value) ?? 'pr')}>
          <SelectTrigger aria-label="Gate kind" size="sm" className="dshx:h-8 dshx:w-44 dshx:text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="dshx-root">
            {BacklogGates.kinds.map(candidate => (
              <SelectItem key={candidate} value={candidate} className="dshx:text-xs">
                {gateKindLabels[candidate]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          aria-label="Gate target"
          type={kind === 'date' ? 'date' : 'text'}
          placeholder={gatePlaceholders[kind]}
          className={inputClass}
          value={target}
          onChange={event => setTarget(event.currentTarget.value)}
        />
        <Button type="submit" size="icon-xs" variant="ghost" aria-label="Add gate" disabled={target.trim() === ''}>
          <PlusIcon />
        </Button>
      </form>
    </section>
  )
}

const pullStateIcons = { open: GitPullRequestIcon, merged: GitMergeIcon, closed: GitPullRequestClosedIcon, unknown: CircleDotIcon } as const
const pullStateTones = {
  open: 'dshx:text-success',
  merged: 'dshx:text-violet',
  closed: 'dshx:text-destructive',
  unknown: 'dshx:text-muted-foreground',
} as const
const checkTones = { passing: 'dshx:text-success', failing: 'dshx:text-destructive', pending: 'dshx:text-warning', none: 'dshx:text-muted-foreground' } as const

/** Linked pull requests with their live state and checks, and the action that links one. */
const PullRequests = (props: { readonly detail: BacklogDetailView }): JSX.Element => {
  const api = useApi(backlogApi)
  const actions = useBacklogActions()
  const item = props.detail.item
  const [draft, setDraft] = useState('')
  const urls = [...item.links.filter(link => link.type === 'url' && BacklogGates.pullRequestOf(link.target) !== null).map(link => link.target)]
  const states = useQuery({
    queryKey: ['dshfiles-backlog', 'pull-requests', item.id, urls.join(' ')],
    enabled: urls.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: ({ signal }) => api.pullRequests({ id: item.id }, { signal }),
    retry: false,
  })
  const pulls = states.data?.pullRequests ?? urls.flatMap(url => {
    const pull = BacklogGates.pullRequestOf(url)
    return pull === null ? [] : [{ url: pull.url, repo: pull.repo, number: pull.number, state: 'unknown' as const, checks: 'none' as const, watched: false }]
  })
  return (
    <section aria-label="Pull requests" className="dshx:flex dshx:flex-col dshx:gap-1.5">
      <Heading title="Pull requests" />
      {pulls.length === 0 ? null : (
        <ul className="dshx:flex dshx:flex-col dshx:gap-0.5">
          {pulls.map(pull => {
            const Icon = pullStateIcons[pull.state]
            return (
              <li key={pull.url} className="dshx:flex dshx:min-h-7 dshx:items-center dshx:gap-2 dshx:px-1 dshx:text-[13px]">
                <Icon aria-hidden className={cn('dshx:size-3.5 dshx:shrink-0', pullStateTones[pull.state])} />
                <a href={pull.url} target="_blank" rel="noreferrer" className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:hover:underline">
                  {pull.repo}#{pull.number}
                </a>
                <span aria-label={`State ${pull.state}`} className={cn('dshx:text-[11px]', pullStateTones[pull.state])}>
                  {pull.state === 'unknown' ? (states.data?.available === false ? 'plain link' : 'not watched') : pull.state}
                </span>
                {pull.checks === 'none' ? null : <span className={cn('dshx:text-[11px]', checkTones[pull.checks])}>checks {pull.checks}</span>}
              </li>
            )
          })}
        </ul>
      )}
      <form
        className="dshx:flex dshx:items-center dshx:gap-1.5"
        onSubmit={event => {
          event.preventDefault()
          if (BacklogGates.pullRequestOf(draft) === null) return
          actions.linkPullRequest.mutate({ id: item.id, url: draft.trim() }, { onError: BacklogNotices.failure('The pull request was not linked.') })
          setDraft('')
        }}
      >
        <input aria-label="Pull request URL" placeholder="Link PR… https://github.com/owner/repo/pull/12" className={inputClass} value={draft} onChange={event => setDraft(event.currentTarget.value)} />
        <Button type="submit" size="icon-xs" variant="ghost" aria-label="Link pull request" disabled={BacklogGates.pullRequestOf(draft) === null}>
          <PlusIcon />
        </Button>
      </form>
    </section>
  )
}

/** Acceptance criteria, plan and final summary: structured fields of their own, never parsed out of the body. */
const Sections = (props: { readonly detail: BacklogDetailView }): JSX.Element => (
  <div className="dshx:flex dshx:flex-col dshx:gap-4">
    <Criteria id={props.detail.item.id} criteria={props.detail.item.criteria ?? []} />
    <Plan detail={props.detail} />
    <Gates id={props.detail.item.id} gates={props.detail.item.gates ?? []} />
    <PullRequests detail={props.detail} />
    <Summary detail={props.detail} />
  </div>
)

export class PeekSections {
  static readonly Sections = Sections
}
