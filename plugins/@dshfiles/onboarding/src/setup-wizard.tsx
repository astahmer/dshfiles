import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@dshfiles/plugin-ui/components/ui/sheet'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Prerequisite, Route } from './catalog-model.js'
import { CHECKLIST_GLYPH, CHECKLIST_LABEL } from './labels.js'
import type { ChecklistItem, Overview, OverviewInput } from './overview-model.js'
import { PHONE_QUERY } from './reach-model.js'
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
  /** Puts the text in the composer; never sends it. False when no composer could take it. */
  readonly insertPrompt: (text: string) => boolean
  /** Done, or Don't show again (`skipped`): kept per browser, so it never opens by itself again. */
  readonly onFinish: (outcome: WizardOutcome) => void
  /** Escape, the close button or a link to a setup page: closed for now, nothing kept (it asks again on the next load). */
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
 * A kit dialog on a wide screen and a bottom sheet on a phone: focus stays inside, and Escape or the close button put
 * it away for now. Following a link closes it too, so the page it opens is usable; Getting started's Start setup and
 * ⌘K Show the setup wizard bring it back. Don't show again and Done are the only outcomes kept.
 */
export const SetupWizard = (props: SetupWizardProps): ReactNode => {
  const viewportPhone = useSyncExternalStore(subscribePhone, readPhone, () => false)
  const phone = props.phone ?? viewportPhone
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
  const routes = props.routes
  // A modal wizard over the page it links to would hide that page: put the wizard away, then open the page.
  const go = (open: () => void): void => {
    props.onClose()
    open()
  }
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
          <Button onClick={() => setInserted(props.insertPrompt(prompt))} variant="outline">
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
      <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
        {overview.isPending ? (
          <p className="dshx:text-sm dshx:text-muted-foreground" role="status">
            Checking…
          </p>
        ) : null}
        <EntityList aria-label={step.title}>
          {items.map(item => (
            <Item go={route => go(() => Routes.open(route, routes))} item={item} key={item.id} routes={routes} />
          ))}
          {step.id === 'project' && routes.hasSettings() ? (
            <EntityRow
              heading="Give each new thread its own workspace"
              role="listitem"
              trailing={
                <Button onClick={() => go(() => routes.openSettings(isolate))} size="sm" variant="outline">
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
        <Button onClick={() => setIndex(index - 1)} variant="outline">
          Back
        </Button>
      )}
      <Button onClick={() => (last ? props.onFinish('done') : setIndex(index + 1))}>{last ? 'Done' : 'Next'}</Button>
    </>
  )
  const onOpenChange = (open: boolean): void => {
    if (!open) props.onClose()
  }

  if (phone)
    return (
      <Sheet onOpenChange={onOpenChange} open={props.open}>
        <SheetContent
          className="dshx-root dshx:@container dshx:max-h-[85dvh] dshx:gap-3 dshx:overflow-y-auto dshx:rounded-t-2xl dshx:px-4 dshx:pt-4 dshx:pb-[max(1rem,var(--dshx-safe-bottom))] dshx:shadow-s3"
          data-setup-wizard={step.id}
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
  return (
    <Dialog onOpenChange={onOpenChange} open={props.open}>
      <DialogContent
        className="dshx-root dshx:@container dshx:max-h-[85dvh] dshx:gap-4 dshx:overflow-y-auto dshx:rounded-xl dshx:p-5 dshx:shadow-s3 dshx:sm:max-w-md"
        data-setup-wizard={step.id}
      >
        <DialogHeader className="dshx:gap-0.5 dshx:pr-8 dshx:text-left">
          <DialogDescription className="dshx:text-xs">{position}</DialogDescription>
          <DialogTitle className="dshx:text-base">{step.title}</DialogTitle>
        </DialogHeader>
        {body}
        <DialogFooter className="dshx:flex-row dshx:flex-wrap dshx:justify-end">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
