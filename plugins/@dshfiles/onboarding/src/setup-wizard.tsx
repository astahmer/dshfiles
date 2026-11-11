import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { CheckCircle2Icon, CircleDashedIcon, CircleHelpIcon, CircleOffIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useId, useState, type ReactNode } from 'react'
import type { Prerequisite } from './catalog-model.js'
import { TOUCH } from './touch.js'
import type { ChecklistItem, Overview, OverviewInput } from './overview-model.js'
import { Routes, type RouteServices } from './routes.js'

export type WizardOutcome = 'done' | 'skipped'

const STEPS = [
  { id: 'account', title: 'Connect an AI account', items: ['account'] },
  { id: 'project', title: 'Add a project', items: ['project', 'repository'] },
  { id: 'first-task', title: 'Start a first task', items: [] },
] as const satisfies readonly { readonly id: string; readonly title: string; readonly items: readonly Prerequisite[] }[]

export const STARTER_PROMPTS = [
  'Explain how this project is organised and where I should start reading.',
  'Find one small bug or rough edge in this project and propose a fix before changing anything.',
  'Add a test for the most important function in this project that has none.',
] as const

const STATE_ICON = { done: CheckCircle2Icon, todo: CircleDashedIcon, unknown: CircleHelpIcon, off: CircleOffIcon } as const

const Item = (props: { readonly item: ChecklistItem; readonly routes: RouteServices }): ReactNode => {
  const Icon = STATE_ICON[props.item.state]
  const route = props.item.fix.route
  return (
    <li
      className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-2"
      data-state={props.item.state}
      data-wizard-item={props.item.id}
    >
      <Icon
        aria-label={props.item.state === 'done' ? 'Done' : 'To do'}
        className={cn('dshx:size-5 dshx:shrink-0', props.item.state === 'done' && 'dshx:text-success')}
        role="img"
      />
      <div className="dshx:min-w-0 dshx:flex-1">
        <p className="dshx:text-sm dshx:font-medium">{props.item.title}</p>
        <p className="dshx:text-xs dshx:text-muted-foreground">{props.item.detail}</p>
      </div>
      {props.item.state !== 'done' && route !== null && Routes.available(route, props.routes) ? (
        <Button className={TOUCH} onClick={() => Routes.open(route, props.routes)} size="sm" variant="outline">
          {props.item.fix.label}
        </Button>
      ) : null}
    </li>
  )
}

export interface SetupWizardProps {
  readonly open: boolean
  readonly loadOverview: (input: OverviewInput, signal: AbortSignal) => Promise<Overview>
  readonly routes: RouteServices
  /** Puts the text in the composer; never sends it. False when no composer could take it. */
  readonly insertPrompt: (text: string) => boolean
  readonly onFinish: (outcome: WizardOutcome) => void
}

/**
 * Three steps that link to the pages owning each setup and end with a prompt in the composer; it writes nothing itself.
 * A floating card, not a modal: the app stays usable around it (no gate), and Escape skips it.
 */
export const SetupWizard = (props: SetupWizardProps): ReactNode => {
  const [index, setIndex] = useState(0)
  const [prompt, setPrompt] = useState<string>(STARTER_PROMPTS[0])
  const [inserted, setInserted] = useState<boolean | undefined>()
  const overview = useQuery({
    queryKey: ['onboarding', 'overview', '', null],
    queryFn: ({ signal }) => props.loadOverview({}, signal),
    enabled: props.open,
    retry: false,
  })
  const step = STEPS[index] ?? STEPS[0]
  const items = step.items.flatMap(id => overview.data?.checklist?.find(item => item.id === id) ?? [])
  const last = index === STEPS.length - 1
  const isolate = { setting: { entryId: 'jj-integration', fieldPath: ['isolateByDefault'] } } as const

  const titleId = useId()
  if (!props.open) return null
  return (
    <section
      aria-labelledby={titleId}
      className="dshx-root dshx:@container dshx:fixed dshx:top-14 dshx:right-3 dshx:z-[900] dshx:flex dshx:max-h-[calc(100dvh-5rem)] dshx:w-[24rem] dshx:max-w-[calc(100vw-1.5rem)] dshx:flex-col dshx:gap-4 dshx:overflow-y-auto dshx:rounded-lg dshx:border dshx:border-border dshx:bg-background dshx:p-4 dshx:shadow-lg"
      data-setup-wizard={step.id}
      onKeyDown={event => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        props.onFinish('skipped')
      }}
    >
      <header className="dshx:flex dshx:flex-col dshx:gap-0.5">
        <p className="dshx:text-xs dshx:text-muted-foreground">
          Step {String(index + 1)} of {String(STEPS.length)}
        </p>
        <h2 className="dshx:text-base dshx:font-semibold" id={titleId}>
          {step.title}
        </h2>
      </header>
      {step.id === 'first-task' ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          <ul aria-label="Starter prompts" className="dshx:flex dshx:flex-col dshx:gap-1.5">
            {STARTER_PROMPTS.map(text => (
              <li key={text}>
                <Button
                  aria-pressed={prompt === text}
                  className={cn('dshx:h-auto dshx:min-h-8 dshx:w-full dshx:justify-start dshx:py-2 dshx:text-left dshx:whitespace-normal', TOUCH)}
                  onClick={() => {
                    setPrompt(text)
                    setInserted(undefined)
                  }}
                  variant={prompt === text ? 'secondary' : 'ghost'}
                >
                  {text}
                </Button>
              </li>
            ))}
          </ul>
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <Button className={TOUCH} onClick={() => setInserted(props.insertPrompt(prompt))} variant="outline">
              Insert prompt
            </Button>
            {inserted === undefined ? null : (
              <span className="dshx:text-xs dshx:text-muted-foreground" role="status">
                {inserted ? 'In the composer. Send it when ready.' : 'No composer is open. Open a thread, then insert again.'}
              </span>
            )}
          </div>
        </div>
      ) : (
        <ul className="dshx:flex dshx:flex-col dshx:gap-3">
          {overview.isPending ? <li className="dshx:text-sm dshx:text-muted-foreground">Checking…</li> : null}
          {items.map(item => (
            <Item item={item} key={item.id} routes={props.routes} />
          ))}
          {step.id === 'project' && props.routes.hasSettings() ? (
            <li className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-2">
              <p className="dshx:min-w-0 dshx:flex-1 dshx:text-sm dshx:font-medium">Give each new thread its own workspace</p>
              <Button className={TOUCH} onClick={() => props.routes.openSettings(isolate)} size="sm" variant="outline">
                Isolate new threads
              </Button>
            </li>
          ) : null}
        </ul>
      )}
      <footer className="dshx:flex dshx:flex-wrap dshx:justify-end dshx:gap-2">
        <Button className={cn('dshx:mr-auto', TOUCH)} onClick={() => props.onFinish('skipped')} variant="ghost">
          Skip
        </Button>
        {index === 0 ? null : (
          <Button className={TOUCH} onClick={() => setIndex(index - 1)} variant="outline">
            Back
          </Button>
        )}
        <Button className={TOUCH} onClick={() => (last ? props.onFinish('done') : setIndex(index + 1))}>
          {last ? 'Done' : 'Next'}
        </Button>
      </footer>
    </section>
  )
}
