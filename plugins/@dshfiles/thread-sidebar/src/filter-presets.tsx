/**
 * Filter presets (b:xpvk): the name prompt behind "Save current filters as preset…" and "Rename…", the delete
 * confirmation, and the optional chips row. The presets themselves are the saved thread views in the sidebar's Host
 * settings (`threadViews`); this file only draws the prompts and the chips, the list owns every write.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useId, useRef, useState } from 'react'
import type { ThreadSidebarTranslate } from './thread-view-manager.js'

export const PRESET_NAME_MAX_LENGTH = 32

/** Why a preset name cannot be saved, as a locale key; undefined when it can. */
export const presetNameIssue = (
  name: string,
  existingNames: readonly string[],
): 'threadSidebarViewNameRequired' | 'threadSidebarViewNameTooLong' | 'threadSidebarViewNameExists' | undefined => {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'threadSidebarViewNameRequired'
  if (trimmed.length > PRESET_NAME_MAX_LENGTH) return 'threadSidebarViewNameTooLong'
  if (existingNames.some(existing => existing.trim().toLowerCase() === trimmed.toLowerCase())) return 'threadSidebarViewNameExists'
  return undefined
}

export type PresetNamePrompt = { readonly mode: 'create' } | { readonly mode: 'rename'; readonly viewId: string; readonly name: string }

interface PresetNameDialogProps {
  readonly prompt: PresetNamePrompt | null
  /** Every other preset's shown name: a new name must differ from all of them. */
  readonly existingNames: readonly string[]
  readonly onSubmit: (prompt: PresetNamePrompt, name: string) => void
  readonly onClose: () => void
  readonly t: ThreadSidebarTranslate
}

/** One field, so plain state rather than a form store: the name a preset is saved or renamed under. */
export const PresetNameDialog = (props: PresetNameDialogProps): JSX.Element => {
  const prompt = props.prompt
  return (
    <Dialog open={prompt !== null} onOpenChange={open => !open && props.onClose()}>
      {/* Fixed to the viewport, so viewport widths apply: on a phone it sits at the top, where the keyboard never covers the field. */}
      <DialogContent className="dshx-root dshx:sm:max-w-sm dshx:max-sm:top-3 dshx:max-sm:translate-y-0" closeLabel={props.t('threadSidebarClose')}>
        {prompt === null ? null : (
          <PresetNameForm
            key={prompt.mode === 'rename' ? prompt.viewId : 'create'}
            prompt={prompt}
            existingNames={props.existingNames}
            onSubmit={props.onSubmit}
            onClose={props.onClose}
            t={props.t}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

const PresetNameForm = (props: Omit<PresetNameDialogProps, 'prompt'> & { readonly prompt: PresetNamePrompt }): JSX.Element => {
  const fieldId = useId()
  const [name, setName] = useState(props.prompt.mode === 'rename' ? props.prompt.name : '')
  const [touched, setTouched] = useState(false)
  const issue = presetNameIssue(name, props.existingNames)
  return (
    <form
      className="dshx:grid dshx:gap-4"
      noValidate
      onSubmit={event => {
        event.preventDefault()
        setTouched(true)
        if (issue !== undefined) return
        props.onSubmit(props.prompt, name.trim())
      }}
    >
      <DialogHeader>
        <DialogTitle>{props.t(props.prompt.mode === 'rename' ? 'threadSidebarPresetRenameTitle' : 'threadSidebarPresetNameTitle')}</DialogTitle>
        <DialogDescription>{props.t('threadSidebarPresetNameHint')}</DialogDescription>
      </DialogHeader>
      <div className="dshx:grid dshx:gap-1.5">
        <Label htmlFor={fieldId}>{props.t('threadSidebarPresetName')}</Label>
        <Input
          id={fieldId}
          autoFocus
          autoComplete="off"
          maxLength={PRESET_NAME_MAX_LENGTH + 8}
          value={name}
          aria-invalid={touched && issue !== undefined}
          aria-describedby={touched && issue !== undefined ? `${fieldId}-issue` : undefined}
          onChange={event => setName(event.target.value)}
          onBlur={() => setTouched(name.length > 0)}
        />
        {touched && issue !== undefined ? (
          <p id={`${fieldId}-issue`} className="dshx:text-xs dshx:text-destructive" role="alert">
            {props.t(issue)}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={props.onClose}>
          {props.t('threadSidebarCancel')}
        </Button>
        <Button type="submit">{props.t('threadSidebarPresetSave')}</Button>
      </DialogFooter>
    </form>
  )
}

interface PresetDeleteDialogProps {
  readonly preset: { readonly id: string; readonly label: string } | null
  readonly onConfirm: (viewId: string) => void
  readonly onClose: () => void
  readonly t: ThreadSidebarTranslate
}

export const PresetDeleteDialog = (props: PresetDeleteDialogProps): JSX.Element => (
  <AlertDialog open={props.preset !== null} onOpenChange={open => !open && props.onClose()}>
    <AlertDialogContent className="dshx-root">
      <AlertDialogHeader>
        <AlertDialogTitle>{props.t('threadSidebarPresetDeleteTitle', { name: props.preset?.label ?? '' })}</AlertDialogTitle>
        <AlertDialogDescription>{props.t('threadSidebarPresetDeleteHint')}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{props.t('threadSidebarCancel')}</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          onClick={() => {
            if (props.preset !== null) props.onConfirm(props.preset.id)
          }}
        >
          {props.t('threadSidebarPresetDeleteConfirm')}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)

interface PresetChipsProps {
  readonly presets: readonly { readonly id: string; readonly label: string }[]
  readonly activeId: string
  readonly edited: boolean
  readonly onApply: (viewId: string) => void
  readonly t: ThreadSidebarTranslate
}

/**
 * The optional chips row ("Show filter presets as chips"): one pressed chip per enabled preset, one tap to apply. The
 * row scrolls sideways when the presets do not fit, and the active chip is always scrolled into view.
 */
export const PresetChips = (props: PresetChipsProps): JSX.Element => {
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const active = row.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    const container = row.current
    if (active == null || container === null) return
    // Scroll the row only, never the page: scrollIntoView would also move the list's own scroller.
    const left = active.offsetLeft - container.offsetLeft
    if (left < container.scrollLeft) container.scrollLeft = left
    else if (left + active.offsetWidth > container.scrollLeft + container.clientWidth) container.scrollLeft = left + active.offsetWidth - container.clientWidth
  }, [props.activeId, props.presets.length])
  return (
    <div
      ref={row}
      role="group"
      aria-label={props.t('threadSidebarPresetChips')}
      data-thread-preset-chips=""
      className="dshx:flex dshx:gap-1 dshx:overflow-x-auto dshx:pt-1 dshx:pb-0.5 dshx:[scrollbar-width:none]"
    >
      {props.presets.map(preset => {
        const active = preset.id === props.activeId
        return (
          <Button
            key={preset.id}
            type="button"
            size="sm"
            variant={active ? 'secondary' : 'outline'}
            aria-pressed={active}
            aria-label={active && props.edited ? props.t('threadSidebarPresetEdited', { name: preset.label }) : preset.label}
            className={cn('dshx:h-7 dshx:shrink-0 dshx:rounded-full dshx:px-2.5 dshx:text-xs', !active && 'dshx:text-muted-foreground')}
            onClick={() => props.onApply(preset.id)}
          >
            <span className="dshx:max-w-32 dshx:truncate">{preset.label}</span>
            {active && props.edited ? <span aria-hidden="true" className="dshx:size-1.5 dshx:shrink-0 dshx:rounded-full dshx:bg-primary" /> : null}
          </Button>
        )
      })}
    </div>
  )
}
