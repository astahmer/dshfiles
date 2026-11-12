import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@dshfiles/plugin-ui/components/ui/sheet'
import { XIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Prerequisite, Route } from './catalog-model.js'
import { CHECKLIST_GLYPH, CHECKLIST_LABEL } from './labels.js'
import type { ChecklistItem, Overview, OverviewInput } from './overview-model.js'
import { PHONE_QUERY } from './reach-model.js'
import { Routes, type RouteServices } from './routes.js'

export type WizardOutcome = 'done' | 'skipped'

export const WIZARD_STEPS = ['account', 'project', 'first-task'] as const
export type WizardStep = (typeof WIZARD_STEPS)[number]

/** Show me where's card layer: under Host modals (1000), over the page; the card never blocks what it links to. */
const CARD_LAYER = 999

const STEPS = [
  { id: 'account', title: 'Connect an AI account', items: ['account'] },
  { id: 'project', title: 'Add a project', items: ['project', 'repository'] },
  { id: 'first-task', title: 'Start a first task', items: [] },
] as const satisfies readonly { readonly id: WizardStep; readonly title: string; readonly items: readonly Prerequisite[] }[]

export const STARTER_PROMPTS = [
  'Explain how this project is organised and where I should start reading.',
  'Find one small bug or rough edge in this project and propose a fix before changing anything.',
  'Add a test for the most important function in this project that has none.',
] as const

const Item = (props: { readonly item: ChecklistItem; readonly routes: RouteServices; readonly go: (route: Route) => void }): ReactNode => {
  const route = props.item.fix.route
  return (
    <EntityRow
      data-state={props.item.state}
      data-wizard-item={props.item.id}
      description={props.item.detail}
      heading={props.item.title}
      role="listitem"
      status={CHECKLIST_GLYPH[props.item.state]}
      statusLabel={CHECKLIST_LABEL[props.item.state]}
      trailing={
        props.item.state !== 'done' && route !== null && Routes.available(route, props.routes) ? (
          <Button onClick={() => props.go(route)} size="sm" variant="outline">
            {props.item.fix.label}
          </Button>
        ) : null
      }
    />
  )
}

export interface SetupWizardProps {
  readonly open: boolean
  readonly loadOverview: (input: OverviewInput, signal: AbortSignal) => Promise<Overview>
  readonly routes: RouteServices
  /** The step on screen; kept per browser by the owner, so following a setup link and coming back resumes there. */
  readonly step: WizardStep
  readonly onStepChange: (step: WizardStep) => void
  /** Puts the text in the composer on screen, or a new thread draft; never sends it. */
  readonly insertPrompt: (text: string) => void
  /** Done, or Don't show again (`skipped`): kept per browser, so it never opens by itself again. */
  readonly onFinish: (outcome: WizardOutcome) => void
  /** Escape or the close button: closed for now, nothing kept (it asks again on the next load). */
  readonly onClose: () => void
  /** Phone-width layout; read from the viewport when omitted. */
  readonly phone?: boolean
}

const phoneQuery = (): MediaQueryList | null =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? null : window.matchMedia(PHONE_QUERY)
const subscribePhone = (listener: () => void): (() => void) => {
  const query = phoneQuery()
  query?.addEventListener('change', listener)
  return () => query?.removeEventListener('change', listener)
}
const readPhone = (): boolean => phoneQuery()?.matches === true

/**
 * Three steps that link to the pages owning each setup and end with a prompt in the composer; it writes nothing itself.
 * A non-modal card at the top right of a wide screen and a non-modal bottom sheet on a phone: the app behind it stays
 * usable, so a setup link opens its page beside the card and the card stays on its step. Escape or the close button put
 * it away for now; Getting started's Start setup and ⌘K Show the setup wizard bring it back at the same step. Don't
 * show again and Done are the only outcomes kept.
 */
export const SetupWizard = (props: SetupWizardProps): ReactNode => {
  const viewportPhone = useSyncExternalStore(subscribePhone, readPhone, () => false)
  const phone = props.phone ?? viewportPhone
  const titleId = useId()
  const positionId = useId()
  const [prompt, setPrompt] = useState<string>(STARTER_PROMPTS[0])
  const [inserted, setInserted] = useState(false)
  const overview = useQuery({
    queryKey: ['onboarding', 'overview', '', null],
    queryFn: ({ signal }) => props.loadOverview({}, signal),
    enabled: props.open,
    retry: false,
  })
  const index = Math.max(0, WIZARD_STEPS.indexOf(props.step))
  const step = STEPS[index] ?? STEPS[0]
  const items = step.items.flatMap(id => overview.data?.checklist?.find(item => item.id === id) ?? [])
  const last = index === STEPS.length - 1
  const isolate = { setting: { entryId: 'jj-integration', fieldPath: ['isolateByDefault'] } } as const
  const routes = props.routes
  const moveTo = (next: number): void => props.onStepChange(WIZARD_STEPS[next] ?? props.step)
  const position = `Step ${String(index + 1)} of ${String(STEPS.length)}`

  const body =
    step.id === 'first-task' ? (
      <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
        <ul aria-label="Starter prompts" className="dshx:flex dshx:flex-col dshx:gap-1.5">
          {STARTER_PROMPTS.map(text => (
            <li key={text}>
              <Button
                aria-pressed={prompt === text}
                className="dshx:h-auto dshx:min-h-row dshx:w-full dshx:justify-start dshx:py-2 dshx:text-left dshx:whitespace-normal"
                onClick={() => {
                  setPrompt(text)
                  setInserted(false)
                }}
                variant={prompt === text ? 'secondary' : 'ghost'}
              >
                {text}
              </Button>
            </li>
          ))}
        </ul>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <Button
            onClick={() => {
              props.insertPrompt(prompt)
              setInserted(true)
            }}
            variant="outline"
          >
            Insert prompt
          </Button>
          <span className="dshx:text-xs dshx:text-muted-foreground" role="status">
            {inserted ? 'In the composer. Send it when ready.' : ''}
          </span>
        </div>
      </div>
    ) : (
      <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
        {overview.isPending ? (
          <p className="dshx:text-sm dshx:text-muted-foreground" role="status">
            Checking…
          </p>
        ) : null}
        <EntityList aria-label={step.title}>
          {items.map(item => (
            <Item go={route => Routes.open(route, routes)} item={item} key={item.id} routes={routes} />
          ))}
          {step.id === 'project' && routes.hasSettings() ? (
            <EntityRow
              heading="Give each new thread its own workspace"
              role="listitem"
              trailing={
                <Button onClick={() => routes.openSettings(isolate)} size="sm" variant="outline">
                  Isolate new threads
                </Button>
              }
            />
          ) : null}
        </EntityList>
      </div>
    )
  const footer = (
    <>
      <Button className="dshx:mr-auto" onClick={() => props.onFinish('skipped')} variant="ghost">
        Don't show again
      </Button>
      {index === 0 ? null : (
        <Button onClick={() => moveTo(index - 1)} variant="outline">
          Back
        </Button>
      )}
      <Button onClick={() => (last ? props.onFinish('done') : moveTo(index + 1))}>{last ? 'Done' : 'Next'}</Button>
    </>
  )
  const onOpenChange = (open: boolean): void => {
    if (!open) props.onClose()
  }

  if (phone)
    return (
      <Sheet modal={false} onOpenChange={onOpenChange} open={props.open}>
        <SheetContent
          className="dshx-root dshx:@container dshx:max-h-[85dvh] dshx:gap-3 dshx:overflow-y-auto dshx:rounded-t-2xl dshx:px-4 dshx:pt-4 dshx:pb-[max(1rem,var(--dshx-safe-bottom))] dshx:shadow-s3"
          data-setup-wizard={step.id}
          onInteractOutside={event => event.preventDefault()}
          onOpenAutoFocus={event => event.preventDefault()}
          side="bottom"
        >
          <SheetHeader className="dshx:gap-0.5 dshx:p-0 dshx:pr-8">
            <SheetDescription className="dshx:text-xs">{position}</SheetDescription>
            <SheetTitle className="dshx:text-base">{step.title}</SheetTitle>
          </SheetHeader>
          {body}
          <SheetFooter className="dshx:mt-0 dshx:flex-row dshx:flex-wrap dshx:justify-end dshx:p-0">{footer}</SheetFooter>
        </SheetContent>
      </Sheet>
    )
  if (!props.open) return null
  return (
    <section
      aria-describedby={positionId}
      aria-labelledby={titleId}
      aria-modal="false"
      className="dshx-root dshx:@container dshx:fixed dshx:top-[max(3rem,var(--dshx-safe-top))] dshx:right-3 dshx:flex dshx:max-h-[calc(100dvh-3.75rem)] dshx:w-96 dshx:max-w-[calc(100%-1.5rem)] dshx:flex-col dshx:gap-3 dshx:overflow-y-auto dshx:rounded-xl dshx:border dshx:border-border dshx:bg-popover dshx:p-4 dshx:text-popover-foreground dshx:shadow-s2"
      data-setup-wizard={step.id}
      onKeyDown={event => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        props.onClose()
      }}
      role="dialog"
      style={{ zIndex: CARD_LAYER }}
    >
      <header className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-2">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          <p className="dshx:text-xs dshx:text-muted-foreground" id={positionId}>
            {position}
          </p>
          <h2 className="dshx:text-base dshx:font-semibold" id={titleId}>
            {step.title}
          </h2>
        </div>
        <Button aria-label="Close" onClick={props.onClose} size="icon-sm" variant="ghost">
          <XIcon />
        </Button>
      </header>
      {body}
      <footer className="dshx:flex dshx:flex-row dshx:flex-wrap dshx:justify-end dshx:gap-2">{footer}</footer>
    </section>
  )
}
