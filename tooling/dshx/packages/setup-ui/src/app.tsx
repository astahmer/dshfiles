import * as React from 'react'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { EmptyState, Page, PageSection } from '@dshfiles/plugin-ui/components/page'
import type { StatusGlyphState } from '@dshfiles/plugin-ui/components/work-status'
import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@dshfiles/plugin-ui/components/ui/collapsible'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@dshfiles/plugin-ui/components/ui/radio-group'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import {
  SetupClient,
  SetupRequestError,
  type SetupCheck,
  type SetupPack,
  type SetupPlanResult,
  type SetupProblem,
  type SetupState,
  type SetupStep,
} from './api.js'
import { CheckModel } from './check-model.js'
import { ReviewModel, type PlannedPlugin } from './review-model.js'
import { SelectionModel, type SetupSelection } from './selection.js'

type Screen = 'check' | 'preset' | 'review' | 'apply' | 'done'

const checkStatus = { ok: 'done', warn: 'idle', fail: 'failed' } satisfies Record<SetupCheck['state'], StatusGlyphState>
const checkLabel = { ok: 'Ready', warn: 'Optional', fail: 'Blocks setup' } satisfies Record<SetupCheck['state'], string>
const stepStatus = { running: 'working', done: 'done', failed: 'failed' } satisfies Record<SetupStep['status'], StatusGlyphState>

const problemOf = (error: unknown): SetupProblem =>
  error instanceof SetupRequestError
    ? { message: error.message, hint: error.hint }
    : { message: error instanceof Error ? error.message : String(error), hint: 'Check the terminal running dshx setup.' }

const Problem = ({ problem }: { readonly problem: SetupProblem }) => (
  <Alert variant="destructive">
    <AlertTitle>{problem.message}</AlertTitle>
    <AlertDescription>{problem.hint}</AlertDescription>
  </Alert>
)

/**
 * Copy through a selected off-screen field: the page has no Host to lend DSH's clipboard primitive, and the async
 * Clipboard API exists only in a secure context.
 */
const copyText = (text: string): boolean => {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  return copied
}

const CopyButton = ({ text }: { readonly text: string }) => {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => {
        setCopied(copyText(text))
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

const Command = ({ text }: { readonly text: string }) => <code className="dshx:font-mono dshx:text-xs dshx:break-all dshx:text-foreground">{text}</code>

/** The one disclosure for the exact, auditable detail (ids, paths, commands) that the screen's words summarise. */
const Details = ({ label, children }: { readonly label: string; readonly children: React.ReactNode }) => (
  <Collapsible className="dshx:flex dshx:flex-col dshx:gap-3">
    <CollapsibleTrigger className="dshx:group dshx:flex dshx:w-fit dshx:items-center dshx:gap-1.5 dshx:rounded-sm dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/60">
      <ChevronRightIcon aria-hidden className="dshx:size-3.5 dshx:transition-transform dshx:group-data-[state=open]:rotate-90" />
      {label}
    </CollapsibleTrigger>
    <CollapsibleContent className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">{children}</CollapsibleContent>
  </Collapsible>
)

/** A block of exact text with its Copy button, inside Details. */
const CopyBlock = ({ label, text }: { readonly label: string; readonly text: string }) => (
  <EntityList>
    <EntityRow heading={label} description={<Command text={text} />} trailing={<CopyButton text={text} />} />
  </EntityList>
)

const CheckScreen = ({ state, onRecheck, onContinue }: { readonly state: SetupState; readonly onRecheck: () => void; readonly onContinue: () => void }) => {
  const paths = state.checks.filter(check => check.path !== null)
  return (
    <Page
      heading="Check this machine"
      meta="1 of 4"
      description={CheckModel.summary(state.checks)}
      primaryAction={{ id: 'continue', label: 'Continue', onSelect: onContinue, disabled: state.blocking }}
      actions={[{ id: 'recheck', label: 'Check again', onSelect: onRecheck }]}
    >
      <EntityList>
        {CheckModel.rows(state.checks).map(check => (
          <EntityRow
            key={check.id}
            status={checkStatus[check.state]}
            statusLabel={checkLabel[check.state]}
            heading={check.label}
            meta={check.detail}
            description={check.fix === null ? undefined : <Command text={check.fix} />}
            trailing={check.fix === null ? undefined : <CopyButton text={check.fix} />}
          />
        ))}
      </EntityList>
      {paths.length === 0 ? null : (
        <Details label="Show details">
          <EntityList>
            {paths.map(check => (
              <EntityRow key={check.id} heading={check.label} description={<Command text={check.path ?? ''} />} />
            ))}
          </EntityList>
        </Details>
      )}
    </Page>
  )
}

const PresetScreen = ({
  state,
  selection,
  onChange,
  onBack,
  onReview,
}: {
  readonly state: SetupState
  readonly selection: SetupSelection
  readonly onChange: (selection: SetupSelection) => void
  readonly onBack: () => void
  readonly onReview: () => void
}) => {
  const existing = state.profiles.find(profile => profile.name === selection.profile)
  const preset = SelectionModel.presetOf(selection, state.presets)
  const chosen = state.packs.filter(pack => pack.core || selection.packs.includes(pack.id)).length
  const nameId = React.useId()
  const extendId = React.useId()
  return (
    <Page
      heading="Choose packs"
      meta="2 of 4"
      primaryAction={{ id: 'review', label: 'Review', onSelect: onReview, disabled: !SelectionModel.validName(selection.profile) }}
      actions={[{ id: 'back', label: 'Back', onSelect: onBack }]}
    >
      <PageSection heading="Profile" meta={existing === undefined ? 'New' : 'Already set up'}>
        <div className="dshx:flex dshx:max-w-sm dshx:flex-col dshx:gap-1.5">
          <Label htmlFor={nameId}>Profile name</Label>
          <Input
            id={nameId}
            value={selection.profile}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!SelectionModel.validName(selection.profile)}
            onChange={event => onChange({ ...selection, profile: event.target.value.trim() })}
          />
        </div>
        {existing === undefined || existing.seeded ? null : (
          <div className="dshx:flex dshx:items-center dshx:gap-2">
            <Switch id={extendId} checked={selection.extend} onCheckedChange={checked => onChange({ ...selection, extend: checked })} />
            <Label htmlFor={extendId}>Keep its other plugins</Label>
          </div>
        )}
      </PageSection>
      <PageSection heading="Preset">
        <RadioGroup
          value={preset?.id ?? ''}
          onValueChange={id => onChange(SelectionModel.withPreset(selection, state.presets, id))}
          className="dshx:grid dshx:grid-cols-2 dshx:gap-2 dshx:@max-pane-compact:grid-cols-1"
        >
          {state.presets.map(candidate => (
            <Label
              key={candidate.id}
              className="dshx:flex dshx:min-h-touch dshx:cursor-pointer dshx:items-center dshx:gap-3 dshx:rounded-md dshx:border dshx:border-border dshx:px-3 dshx:py-2 dshx:has-[[data-state=checked]]:border-foreground"
            >
              <RadioGroupItem value={candidate.id} />
              <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:justify-between dshx:gap-2">
                <span className="dshx:text-sm dshx:font-medium">{candidate.title}</span>
                <span className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">{ReviewModel.plural(candidate.packs.length + 1, 'pack')}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </PageSection>
      <PageSection heading="Packs" meta={`${String(chosen)} of ${String(state.packs.length)}`}>
        <EntityList>
          {state.packs.map(pack => {
            const checked = pack.core || selection.packs.includes(pack.id)
            return (
              <EntityRow
                key={pack.id}
                leading={
                  <Checkbox
                    aria-label={pack.title}
                    checked={checked}
                    disabled={pack.core}
                    onCheckedChange={value => onChange(SelectionModel.toggle(selection, pack.id, value === true))}
                  />
                }
                heading={pack.title}
                meta={pack.core ? 'Always on' : ReviewModel.plural(pack.plugins.length, 'plugin')}
                description={pack.summary}
              />
            )
          })}
        </EntityList>
      </PageSection>
    </Page>
  )
}

/** What Review shows: nothing yet, a refusal, or the server's exact plan. */
type Review =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly problem: SetupProblem }
  | { readonly kind: 'plan'; readonly result: SetupPlanResult }

/** A row that opens to the plugins it stands for, by their titles. */
const PluginGroupRow = ({
  heading,
  meta,
  description,
  plugins,
}: {
  readonly heading: string
  readonly meta: string
  readonly description?: string
  readonly plugins: readonly PlannedPlugin[]
}) => {
  const [open, setOpen] = React.useState(false)
  const listId = React.useId()
  return (
    <EntityRow
      leading={
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={`${open ? 'Hide' : 'Show'} the plugins of ${heading}`}
          onClick={() => setOpen(!open)}
        >
          <ChevronRightIcon aria-hidden className={open ? 'dshx:rotate-90 dshx:transition-transform' : 'dshx:transition-transform'} />
        </Button>
      }
      heading={heading}
      meta={meta}
      description={description}
    >
      {open ? (
        <ul
          id={listId}
          className="dshx:m-0 dshx:flex dshx:list-none dshx:flex-col dshx:gap-1 dshx:px-3 dshx:pb-2 dshx:pl-11 dshx:text-xs dshx:text-muted-foreground"
        >
          {plugins.map(plugin => (
            <li key={plugin.name}>{plugin.title}</li>
          ))}
        </ul>
      ) : null}
    </EntityRow>
  )
}

/** Review: one sentence, the chosen packs, the files relative to the DSH home; ids and commands behind Show details. */
export const ReviewScreen = ({
  review,
  packs,
  dshHome,
  onBack,
  onApply,
  onSkip,
}: {
  readonly review: Review
  readonly packs: readonly SetupPack[]
  readonly dshHome: string
  readonly onBack: () => void
  readonly onApply: () => void
  readonly onSkip: () => void
}) => {
  const result = review.kind === 'plan' ? review.result : null
  const problem = review.kind === 'failed' ? review.problem : (result?.problem ?? null)
  const plan = result?.plan ?? null
  const nothingToDo = plan !== null && plan.upToDate && result?.marker === null
  const primaryAction = nothingToDo
    ? { id: 'continue', label: 'Continue', onSelect: onSkip }
    : { id: 'apply', label: 'Apply', onSelect: onApply, disabled: plan === null || problem !== null }
  const groups = result === null || plan === null ? null : ReviewModel.groups({ plan, packs, titles: result.titles })
  const files = result === null ? [] : ReviewModel.files({ result, dshHome })
  return (
    <Page
      heading="Review"
      meta="3 of 4"
      description={plan === null ? undefined : ReviewModel.summary(plan)}
      primaryAction={primaryAction}
      actions={[{ id: 'back', label: 'Back', onSelect: onBack }]}
    >
      {problem === null ? null : <Problem problem={problem} />}
      {review.kind === 'loading' ? <EmptyState>Reading the profile.</EmptyState> : null}
      {plan === null || groups === null ? null : (
        <>
          <PageSection heading="Packs" meta={String(plan.packs.length)}>
            <EntityList>
              {groups.packs.map(group => (
                <PluginGroupRow
                  key={group.id}
                  heading={group.title}
                  meta={ReviewModel.plural(group.plugins.length, 'plugin')}
                  description={group.summary}
                  plugins={group.plugins}
                />
              ))}
              {groups.needed.length === 0 ? null : (
                <PluginGroupRow
                  heading={groups.needed.length === 1 ? 'Needed by another plugin' : 'Needed by other plugins'}
                  meta={`+${String(groups.needed.length)}`}
                  plugins={groups.needed}
                />
              )}
              {groups.kept.length === 0 ? null : (
                <PluginGroupRow heading="Already in the profile" meta={`${String(groups.kept.length)} kept`} plugins={groups.kept} />
              )}
            </EntityList>
          </PageSection>
          {files.length === 0 ? null : (
            <PageSection heading="Files" description={<Command text={dshHome} />}>
              <EntityList>
                {files.map(file => (
                  <EntityRow key={`${file.path}:${file.change}`} heading={<Command text={file.path} />} meta={file.change} />
                ))}
              </EntityList>
            </PageSection>
          )}
          <Details label="Show details">
            <EntityList>
              <EntityRow
                heading="Plugins"
                description={
                  <ul className="dshx:m-0 dshx:flex dshx:list-none dshx:flex-col dshx:gap-0.5 dshx:p-0">
                    {[...plan.plugins, ...plan.kept].map(name => (
                      <li key={name}>
                        <Command text={name} />
                        {plan.suppliers.includes(name) ? ' · needed by another plugin' : null}
                        {plan.kept.includes(name) ? ' · kept' : null}
                        {plan.linked.includes(name) ? null : ' · already linked'}
                      </li>
                    ))}
                  </ul>
                }
              />
            </EntityList>
            {plan.commands.map(command => (
              <CopyBlock key={command} label="Command" text={command} />
            ))}
          </Details>
        </>
      )}
    </Page>
  )
}

const ApplyScreen = ({
  packs,
  profile,
  steps,
  problem,
  onBack,
}: {
  readonly packs: readonly { readonly id: string; readonly title: string }[]
  readonly profile: string
  readonly steps: readonly SetupStep[]
  readonly problem: SetupProblem | null
  readonly onBack: () => void
}) => {
  const compose = steps.find(step => step.id === 'compose')
  const record = steps.find(step => step.id === 'record')
  const packStatus: StatusGlyphState = compose === undefined ? 'idle' : stepStatus[compose.status]
  return (
    <Page
      heading={problem === null ? 'Applying' : 'Apply stopped'}
      meta="4 of 4"
      description={compose === undefined && problem === null ? 'Checking the plan again.' : `Adding ${ReviewModel.plural(packs.length, 'pack')} to ${profile}.`}
      {...(problem === null ? {} : { primaryAction: { id: 'back', label: 'Back to review', onSelect: onBack } })}
    >
      {problem === null ? null : <Problem problem={problem} />}
      <EntityList>
        {packs.map(pack => (
          <EntityRow key={pack.id} status={packStatus} heading={pack.title} />
        ))}
        {record === undefined ? null : <EntityRow status={stepStatus[record.status]} heading={record.label} />}
      </EntityList>
    </Page>
  )
}

const DoneScreen = ({ result, profile, onClose }: { readonly result: SetupPlanResult; readonly profile: string; readonly onClose: () => void }) => {
  const [stopped, setStopped] = React.useState(false)
  if (stopped)
    return (
      <Page heading="Setup stopped">
        <EmptyState>You can close this tab.</EmptyState>
      </Page>
    )
  return (
    <Page
      heading={`Profile ${profile} is ready`}
      description={result.buildCommand === null ? 'Run the start command in a terminal.' : 'Build the new plugins, then run the start command in a terminal.'}
      primaryAction={{
        id: 'close',
        label: 'Close setup',
        onSelect: () => {
          setStopped(true)
          onClose()
        },
      }}
    >
      <EntityList>
        {result.buildCommand === null ? null : (
          <EntityRow
            heading="Build the new plugins"
            meta={ReviewModel.plural(result.unbuilt.length, 'plugin')}
            trailing={<CopyButton text={result.buildCommand} />}
          />
        )}
        <EntityRow heading="Start DSH" trailing={<CopyButton text={result.startCommand} />} />
      </EntityList>
      <Details label="Show commands">
        {result.buildCommand === null ? null : <CopyBlock label="Build" text={result.buildCommand} />}
        <CopyBlock label="Start" text={result.startCommand} />
      </Details>
    </Page>
  )
}

/** Check → Preset → Review → Apply → Done; every write happens on the server after the exact plan was shown. */
export const App = () => {
  const [screen, setScreen] = React.useState<Screen>('check')
  const [state, setState] = React.useState<SetupState | null>(null)
  const [loadProblem, setLoadProblem] = React.useState<SetupProblem | null>(null)
  const [selection, setSelection] = React.useState<SetupSelection | null>(null)
  const [review, setReview] = React.useState<Review>({ kind: 'loading' })
  const [steps, setSteps] = React.useState<readonly SetupStep[]>([])
  const [applyProblem, setApplyProblem] = React.useState<SetupProblem | null>(null)
  const [result, setResult] = React.useState<SetupPlanResult | null>(null)

  const load = React.useCallback(() => {
    setLoadProblem(null)
    SetupClient.state()
      .then(next => {
        setState(next)
        setSelection(current => current ?? SelectionModel.initial(next))
      })
      .catch((error: unknown) => setLoadProblem(problemOf(error)))
  }, [])

  React.useEffect(() => {
    SetupClient.signIn()
      .then(load)
      .catch((error: unknown) => setLoadProblem(problemOf(error)))
  }, [load])

  React.useEffect(() => {
    window.scrollTo(0, 0)
  }, [screen])

  if (loadProblem !== null)
    return (
      <Page heading="Set up DSH">
        <Problem problem={loadProblem} />
      </Page>
    )
  if (state === null || selection === null)
    return (
      <Page heading="Set up DSH">
        <EmptyState>Checking this machine.</EmptyState>
      </Page>
    )

  const request = SelectionModel.requestOf(selection)
  const startReview = () => {
    setReview({ kind: 'loading' })
    setScreen('review')
    SetupClient.plan(request)
      .then(result => setReview({ kind: 'plan', result }))
      .catch((error: unknown) => setReview({ kind: 'failed', problem: problemOf(error) }))
  }
  const startApply = () => {
    if (review.kind !== 'plan') return
    setSteps([])
    setApplyProblem(null)
    setScreen('apply')
    SetupClient.apply({
      request,
      hash: review.result.hash,
      onEvent: event => {
        if (event.type === 'step') setSteps(current => [...current.filter(step => step.id !== event.step.id), event.step])
        if (event.type === 'error') setApplyProblem(event.error)
        if (event.type === 'done') {
          setResult(event.result)
          setScreen('done')
        }
      },
    }).catch((error: unknown) => setApplyProblem(problemOf(error)))
  }

  switch (screen) {
    case 'check':
      return <CheckScreen state={state} onRecheck={load} onContinue={() => setScreen('preset')} />
    case 'preset':
      return <PresetScreen state={state} selection={selection} onChange={setSelection} onBack={() => setScreen('check')} onReview={startReview} />
    case 'review':
      return (
        <ReviewScreen
          review={review}
          packs={state.packs}
          dshHome={state.dshHome}
          onBack={() => setScreen('preset')}
          onApply={startApply}
          onSkip={() => {
            if (review.kind === 'plan') setResult(review.result)
            setScreen('done')
          }}
        />
      )
    case 'apply':
      return (
        <ApplyScreen
          packs={review.kind === 'plan' ? (review.result.plan?.packs ?? []) : []}
          profile={selection.profile}
          steps={steps}
          problem={applyProblem}
          onBack={startReview}
        />
      )
    case 'done':
      return result === null ? null : (
        <DoneScreen result={result} profile={selection.profile} onClose={() => void SetupClient.shutdown().catch(() => undefined)} />
      )
  }
}
