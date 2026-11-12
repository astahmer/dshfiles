/**
 * The composer's one mode chip (composer redesign b:v9yh): plan mode and file access in plain words, one popover with
 * both sections. It replaces the native file-access seat (`conversation.input.permission`, whose labels read
 * "Workspace Write") and the native plan chip (`conversation.input.plan`, a "Plan ×" exit button); the native plan
 * seat's occupant is shadowed, so agent-plan keeps drawing its pinned step beside it.
 *
 * Plan mode and file access are two Host settings with no combined API (docs/ade-ux §4.5): the chip reads the two
 * Session projections (`plan`, `permissions`) and writes each through its own supported command (`/plan`, `/plan off`,
 * `/permission <preset>`), the same commands the native controls and the slash menu run. The process permission
 * catalog comes from the same Remote the native picker reads (`permissionPresets.catalog`, re-read on
 * `permission-presets/catalog-changed`). A new thread with defaults needs no change here: the chip only shows what
 * the Host already applied.
 */
import { useEffect, useState, useSyncExternalStore, type JSX } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-plan-mode/client'
import { RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { ChevronDownIcon, EyeIcon, ListChecksIcon, PencilLineIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { ModeChipCatalog, ModeChipModel, type ModeChipHost } from './mode-chip-model.ts'

const accessIcon = (value: string): JSX.Element => {
  const className = 'dshx:size-3.5 dshx:shrink-0'
  if (value === 'read-only') return <EyeIcon aria-hidden className={className} />
  if (value === 'workspace-write') return <PencilLineIcon aria-hidden className={className} />
  if (value === 'danger-full-access') return <ShieldAlertIcon aria-hidden className={className} />
  if (value === 'auto') return <ShieldCheckIcon aria-hidden className={className} />
  return <ShieldIcon aria-hidden className={className} />
}

export interface ModeChipProps {
  readonly sessionId: string
  readonly locked: boolean
  readonly useProjection: UseProjection
}

export const ModeChip = (props: ModeChipProps & { readonly host: ModeChipHost; readonly catalog: ModeChipCatalog }): JSX.Element | null => {
  const selection = props.useProjection('permissions')
  const plan = props.useProjection('plan', value => (value === undefined ? undefined : value.pending ? !value.active : value.active))
  const catalog = useSyncExternalStore(props.catalog.subscribe, props.catalog.get, props.catalog.get)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const readOnlyBeforeStart = selection === undefined
  useEffect(() => {
    if (props.locked && !readOnlyBeforeStart) {
      setOpen(false)
      setConfirm(null)
    }
  }, [props.locked, readOnlyBeforeStart])
  useEffect(() => {
    if (open) void props.catalog.refresh()
  }, [open, props.catalog])
  // A new thread has no `permissions` projection until its Host session exists, yet the Host already knows what it will
  // apply: the catalog's default. The chip shows it, so the new-thread bar and the thread say the same thing (b:gyk7);
  // it can be changed once the thread has started.
  const draftDefault = selection === undefined ? catalog?.defaultPreset : undefined
  const beforeStart = selection === undefined && draftDefault !== undefined
  // Neither setting composed on this Host: nothing to show. Plan mode alone still gets the chip, so it can be left.
  if (selection === undefined && draftDefault === undefined && plan === undefined) return null

  const current = selection === undefined ? draftDefault : (pending ?? selection.currentValue)
  const option = current === undefined ? undefined : catalog?.options.find(entry => entry.value === current)
  const planOn = plan === true
  const label =
    current === undefined ? (planOn ? 'Plan' : 'Standard') : ModeChipModel.chipLabel({ plan: planOn, access: ModeChipModel.accessLabel(current, option?.name) })
  const run = (line: string, optimistic?: string): void => {
    setError(null)
    if (optimistic !== undefined) setPending(optimistic)
    void props.host
      .run(props.sessionId, line)
      .then(failure => setError(failure))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setPending(null))
  }
  const chooseAccess = (value: string): void => {
    if (value === selection?.currentValue) return
    if (ModeChipModel.isRisky(value)) {
      setAcknowledged(false)
      setConfirm(value)
      return
    }
    run(`/permission ${value}`, value)
  }
  const confirmation = confirm === 'auto' ? 'Auto review' : 'Full access'

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`Access mode, current: ${label}`}
            className={cn(
              'dshx-root dshx:h-7 dshx:min-w-0 dshx:max-w-56 dshx:shrink dshx:gap-1.5 dshx:px-2 dshx:text-xs dshx:font-medium dshx:text-muted-foreground dshx:hover:text-foreground dshx:data-[state=open]:bg-accent dshx:data-[state=open]:text-foreground',
              current === 'danger-full-access' && 'dshx:text-foreground',
            )}
            data-composer-mode-chip=""
            data-plan-mode={planOn ? 'on' : 'off'}
            data-access={current ?? 'none'}
            // Before the first message the seat is locked, but the menu only shows what the thread will start with.
            disabled={(props.locked && !beforeStart) || pending !== null}
            onMouseDown={event => event.preventDefault()}
            size="sm"
            type="button"
            variant="ghost"
          >
            {planOn || current === undefined ? <ListChecksIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" /> : accessIcon(current)}
            {/* Collapse order (plugin-ui): this label leaves before the model name truncates; the accessible name stays. */}
            <span className="dshx:min-w-0 dshx:truncate dshx:in-data-model-compact:hidden" data-composer-mode-label="">
              {label}
            </span>
            <ChevronDownIcon aria-hidden className="dshx:size-3 dshx:shrink-0 dshx:opacity-60 dshx:in-data-model-compact:hidden" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          aria-label="Mode and file access"
          className="dshx-root dshx:w-72"
          side="top"
          onCloseAutoFocus={event => event.preventDefault()}
        >
          {plan === undefined ? null : (
            <>
              <DropdownMenuLabel>Mode</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={planOn ? 'plan' : 'standard'} onValueChange={value => run(ModeChipModel.planLine(value === 'plan'))}>
                <DropdownMenuRadioItem value="standard" data-composer-mode-option="standard">
                  <ModeRow label="Standard" detail="Works on the task directly." />
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="plan" data-composer-mode-option="plan">
                  <ModeRow label="Plan" detail="Writes a plan first; nothing changes until you approve it." />
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              {current === undefined ? null : <DropdownMenuSeparator />}
            </>
          )}
          {current === undefined ? null : <DropdownMenuLabel>File access</DropdownMenuLabel>}
          {current === undefined ? null : catalog === null ? (
            <p className="dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">Loading the choices…</p>
          ) : (
            <DropdownMenuRadioGroup value={current} onValueChange={chooseAccess}>
              {catalog.options.map(entry => (
                <DropdownMenuRadioItem key={entry.value} value={entry.value} data-composer-access-option={entry.value} disabled={beforeStart}>
                  <ModeRow label={ModeChipModel.accessLabel(entry.value, entry.name)} detail={ModeChipModel.accessDetail(entry)} />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}
          {beforeStart ? (
            <p className="dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground" data-composer-access-note="">
              This thread starts with this access. Change it here once you have sent the first message.
            </p>
          ) : null}
          {error === null ? null : (
            <p className="dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-destructive" role="status">
              Could not change it: {error}. Pick again, or type /permission in the composer.
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirm === null || current === undefined ? null : (
        <RiskConfirmation
          open
          title={`Turn on ${confirmation}?`}
          description={
            confirm === 'auto'
              ? 'A reviewer approves routine actions for the agent, so fewer actions stop to ask you. Use it only when you trust this task.'
              : 'The agent can change any file and run commands without asking, including sensitive operations. Use it only when you trust this task.'
          }
          acknowledgeLabel="I understand the risk and want to continue"
          cancelLabel="Cancel"
          closeLabel="Close"
          confirmLabel={`Turn on ${confirmation}`}
          acknowledged={acknowledged}
          disabled={props.locked}
          onAcknowledgedChange={setAcknowledged}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            run(`/permission ${confirm}`, confirm)
          }}
        />
      )}
    </>
  )
}

const ModeRow = (props: { readonly label: string; readonly detail: string | undefined }): JSX.Element => (
  <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
    <span className="dshx:text-sm">{props.label}</span>
    {props.detail === undefined ? null : <span className="dshx:text-xs dshx:text-muted-foreground">{props.detail}</span>}
  </span>
)
