import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { CopyIcon, ExternalLinkIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { PackChangeFlow } from './pack-change-flow.js'
import { RESTART_GUIDANCE, type PackAction, type PackOutcome, type PackPreview, type PackSummary, type StepResult } from './pack-plan.js'

/** 44 px on phones and touch screens, the kit's own height elsewhere. */
const TOUCH = 'dshx:max-sm:min-h-[44px] dshx:pointer-coarse:min-h-[44px]'

export interface PackTarget {
  readonly pack: string
  readonly title: string
  readonly action: PackAction
}

export interface PackChangeDialogProps {
  readonly target: PackTarget | null
  readonly loadPreview: (target: PackTarget, signal: AbortSignal) => Promise<PackPreview>
  readonly applyPack: (input: {
    readonly pack: string
    readonly action: PackAction
    readonly confirm: true
    readonly plugins: readonly string[]
  }) => Promise<PackOutcome>
  readonly copy: (text: string) => Promise<boolean>
  readonly onClose: () => void
  /** Something may have changed on the Host: reread what the page shows. */
  readonly onSettled: () => void
}

const VERB = { enable: 'Enable', disable: 'Disable' } as const
const STATUS_LABEL = {
  applied: 'applied',
  'restart-required': 'waits for a restart',
  overridden: 'overridden by a higher layer',
  failed: 'failed',
  cancelled: 'not started',
  manual: 'install by hand',
} as const satisfies Record<StepResult['status'], string>
const SUMMARY_VARIANT = {
  'up-to-date': 'default',
  applied: 'default',
  'restart-required': 'default',
  partial: 'warning',
  manual: 'warning',
  cancelled: 'warning',
  failed: 'destructive',
} as const satisfies Record<PackSummary['kind'], 'default' | 'warning' | 'destructive'>
const SUMMARY_TITLE = {
  'up-to-date': 'Up to date',
  applied: 'Done',
  'restart-required': 'Saved; waits for a restart',
  partial: 'Partly done',
  manual: 'Install by hand',
  cancelled: 'Cancelled',
  failed: 'Not changed',
} as const satisfies Record<PackSummary['kind'], string>

const CopyCommand = (props: { readonly command: string; readonly copy: (text: string) => Promise<boolean> }): ReactNode => {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      aria-label={`Copy ${props.command}`}
      className={cn('dshx:h-auto dshx:max-w-full dshx:shrink dshx:justify-start dshx:py-1.5 dshx:text-left dshx:whitespace-normal', TOUCH)}
      onClick={() => void props.copy(props.command).then(setCopied)}
      size="sm"
      variant="outline"
    >
      <CopyIcon /> <code className="dshx:min-w-0 dshx:font-mono! dshx:text-xs dshx:break-all">{copied ? 'Copied' : props.command}</code>
    </Button>
  )
}

const Section = (props: { readonly id: string; readonly heading: string; readonly children: ReactNode }): ReactNode => (
  <section aria-label={props.heading} className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1.5" data-preview-section={props.id}>
    <h3 className="dshx:text-xs dshx:font-semibold dshx:text-muted-foreground">{props.heading}</h3>
    {props.children}
  </section>
)

const Names = (props: { readonly items: readonly { readonly key: string; readonly text: string }[] }): ReactNode => (
  <ul className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
    {props.items.map(item => (
      <li key={item.key}>
        <Badge variant="outline">{item.text}</Badge>
      </li>
    ))}
  </ul>
)

const PreviewBody = (props: { readonly preview: PackPreview; readonly copy: (text: string) => Promise<boolean> }): ReactNode => {
  const { preview } = props
  if (preview.unavailable !== null) return <p className="dshx:text-sm">{preview.unavailable}</p>
  if (preview.upToDate)
    return (
      <p className="dshx:text-sm" data-up-to-date="">
        Up to date: every plugin of {preview.title} is already {preview.action === 'enable' ? 'enabled' : 'disabled or shared'}. Nothing will change.
      </p>
    )
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">
      {preview.install.length === 0 ? null : (
        <Section heading={preview.installMode === 'manual' ? 'Install by hand' : 'Install'} id="install">
          {preview.installMode === 'manual' ? (
            <>
              <p className="dshx:text-xs dshx:text-muted-foreground">{preview.manualReason} Run each command from the dshfiles checkout:</p>
              <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1.5">
                {preview.install.map(step => (
                  <CopyCommand command={step.command} copy={props.copy} key={step.plugin} />
                ))}
              </div>
              <Button asChild className={cn('dshx:self-start', TOUCH)} size="sm" variant="ghost">
                <a href={preview.docsUrl} rel="noopener noreferrer" target="_blank">
                  <ExternalLinkIcon /> Installing into a profile
                </a>
              </Button>
            </>
          ) : (
            <Names items={preview.install.map(step => ({ key: step.plugin, text: step.plugin }))} />
          )}
        </Section>
      )}
      {preview.change.length === 0 ? null : (
        <Section heading={VERB[preview.action]} id="change">
          <Names items={preview.change.map(step => ({ key: step.plugin, text: step.plugin }))} />
        </Section>
      )}
      {preview.fine.length === 0 ? null : (
        <Section heading="Already fine" id="fine">
          <Names
            items={preview.fine.map(step => ({ key: step.plugin, text: `${step.plugin} · ${step.state === 'not-installed' ? 'not installed' : step.state}` }))}
          />
        </Section>
      )}
      {preview.kept.length === 0 ? null : (
        <Section heading="Kept on" id="kept">
          <Names items={preview.kept.map(step => ({ key: step.plugin, text: `${step.plugin} · needed by ${step.neededBy.join(', ')}` }))} />
        </Section>
      )}
      {preview.blocked.length === 0 ? null : (
        <Section heading="Cannot change here" id="blocked">
          <Names items={preview.blocked.map(step => ({ key: step.plugin, text: `${step.plugin} · ${step.reason}` }))} />
        </Section>
      )}
      {preview.prerequisites.length === 0 ? null : (
        <Section heading="Needs" id="prerequisites">
          <Names items={preview.prerequisites.map(item => ({ key: item.id, text: `${item.id} · ${item.state}` }))} />
        </Section>
      )}
      {preview.restart === 'none' ? null : (
        <Section heading="Restart" id="restart">
          <p className="dshx:text-xs dshx:text-muted-foreground">
            {preview.restart === 'required'
              ? `Installed plugins load after a restart: DSH reads the profile at boot. ${RESTART_GUIDANCE}`
              : 'The plugin manager reports, per plugin, whether the change applied live or waits for a restart.'}
          </p>
        </Section>
      )}
    </div>
  )
}

const Results = (props: { readonly results: readonly StepResult[]; readonly queue: readonly string[] }): ReactNode => (
  <ul aria-label="Progress" className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">
    {props.results.map(result => (
      <li
        className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-x-2 dshx:py-1.5"
        data-step-status={result.status}
        key={`${result.plugin}.${result.step}`}
      >
        <span className="dshx:text-sm dshx:font-medium">{result.plugin}</span>
        <span className="dshx:text-xs dshx:text-muted-foreground">
          {result.step} · {STATUS_LABEL[result.status]}
          {result.restartReason === null ? '' : ` (${result.restartReason})`}
          {result.detail === null ? '' : ` — ${result.detail}`}
        </span>
      </li>
    ))}
    {props.queue.map((plugin, index) => (
      <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:py-1.5" data-step-status={index === 0 ? 'running' : 'waiting'} key={plugin}>
        {index === 0 ? <Spinner className="dshx:size-3.5" /> : null}
        <span className="dshx:text-sm dshx:font-medium">{plugin}</span>
        <span className="dshx:text-xs dshx:text-muted-foreground">{index === 0 ? 'working' : 'waiting'}</span>
      </li>
    ))}
  </ul>
)

const ChangeBody = (props: Omit<PackChangeDialogProps, 'target'> & { readonly target: PackTarget; readonly onBusy: (busy: boolean) => void }): ReactNode => {
  const { target } = props
  const [state, send] = useReducer(PackChangeFlow.transition, PackChangeFlow.initial)
  const preview = useQuery({
    queryKey: ['onboarding', 'pack-preview', target.pack, target.action],
    queryFn: ({ signal }) => props.loadPreview(target, signal),
    retry: false,
    gcTime: 0,
  })
  // One Host call per plugin, never two for the same step (React may run an effect twice in development).
  const started = useRef<string | null>(null)
  const current = state.phase === 'applying' ? state.queue[0] : undefined
  const stepKey = state.phase === 'applying' && current !== undefined ? `${String(state.results.length)}:${current}` : null
  const applyPack = props.applyPack
  useEffect(() => {
    if (stepKey === null || current === undefined || started.current === stepKey) return
    started.current = stepKey
    applyPack({ pack: target.pack, action: target.action, confirm: true, plugins: [current] }).then(
      outcome => send({ type: 'step-done', plugin: current, results: outcome.results.filter(result => result.plugin === current) }),
      (error: unknown) =>
        send({
          type: 'step-failed',
          plugin: current,
          reason: `${errorMessage(error, 'The Host did not answer.')} Getting started rereads the Host to show what is on now.`,
        }),
    )
  }, [stepKey, current, applyPack, target.pack, target.action])
  const onSettled = props.onSettled
  const onBusy = props.onBusy
  useEffect(() => {
    onBusy(state.phase === 'applying')
    if (state.phase === 'finished') onSettled()
  }, [state.phase, onSettled, onBusy])

  const verb = VERB[target.action]
  const data = preview.data
  const actionable =
    data !== undefined && data.unavailable === null && (data.change.length > 0 || (data.install.length > 0 && data.installMode === 'automatic'))

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {verb} {target.title}
        </DialogTitle>
        <DialogDescription>
          {state.phase === 'reviewing' ? 'Nothing changes until you confirm.' : state.phase === 'applying' ? 'Working one plugin at a time.' : 'Finished.'}
        </DialogDescription>
      </DialogHeader>
      {state.phase === 'reviewing' ? (
        preview.isPending ? (
          <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground" role="status">
            <Spinner className="dshx:size-4" /> Reading the profile…
          </p>
        ) : data === undefined ? (
          <p className="dshx:text-sm" role="alert">
            {errorMessage(preview.error, 'The preview could not be read.')} Try again, or switch plugins one by one in Settings › Plugins.
          </p>
        ) : (
          <PreviewBody copy={props.copy} preview={data} />
        )
      ) : (
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
          {state.phase === 'finished' ? (
            <Alert data-summary={state.summary.kind} role="status" variant={SUMMARY_VARIANT[state.summary.kind]}>
              <AlertTitle>{SUMMARY_TITLE[state.summary.kind]}</AlertTitle>
              <AlertDescription>
                <p>{state.summary.message}</p>
                {state.summary.nextActions.length === 0 ? null : (
                  <ul className="dshx:mt-1 dshx:flex dshx:list-disc dshx:flex-col dshx:gap-1 dshx:pl-4">
                    {state.summary.nextActions.map(action => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          {state.phase === 'finished'
            ? state.preview.install
                .filter(step => state.results.some(result => result.plugin === step.plugin && (result.status === 'manual' || result.status === 'failed')))
                .map(step => <CopyCommand command={step.command} copy={props.copy} key={step.plugin} />)
            : null}
          <Results queue={state.phase === 'applying' ? state.queue : []} results={state.results} />
        </div>
      )}
      <DialogFooter>
        {state.phase === 'reviewing' ? (
          <>
            <Button className={TOUCH} onClick={props.onClose} variant="outline">
              {actionable ? 'Cancel' : 'Close'}
            </Button>
            {actionable ? (
              <Button className={TOUCH} onClick={() => send({ type: 'confirm', preview: data })}>
                {verb} pack
              </Button>
            ) : null}
          </>
        ) : state.phase === 'applying' ? (
          <Button className={TOUCH} disabled={state.cancelRequested} onClick={() => send({ type: 'cancel' })} variant="outline">
            {state.cancelRequested ? 'Stopping after this plugin…' : 'Stop after this plugin'}
          </Button>
        ) : (
          <Button className={TOUCH} onClick={props.onClose}>
            Close
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

/** The one pack dialog: preview, explicit confirm, per-plugin progress, verdict. It cannot be dismissed mid-change. */
export const PackChangeDialog = (props: PackChangeDialogProps): ReactNode => {
  const [busy, setBusy] = useState(false)
  const target = props.target
  return (
    <Dialog
      onOpenChange={open => {
        if (!open && !busy) props.onClose()
      }}
      open={target !== null}
    >
      <DialogContent className="dshx-root dshx:max-h-[85dvh] dshx:overflow-y-auto" data-pack-dialog={target?.pack} showCloseButton={false}>
        {target === null ? null : <ChangeBody {...props} key={`${target.pack}:${target.action}`} onBusy={setBusy} target={target} />}
      </DialogContent>
    </Dialog>
  )
}
