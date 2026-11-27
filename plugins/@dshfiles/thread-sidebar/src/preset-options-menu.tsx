/**
 * The Filters panel's presets ⋯ menu: Save as new preset…, the active user preset's Rename / Save changes / Delete,
 * Manage presets…, and Mark N shown as read / unread. The list (client.tsx) owns every value and write.
 */
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { OverflowGlyph } from '@dshfiles/plugin-ui/components/ui/overflow-glyph'
import { useId } from 'react'
import type { ListFilterAction } from './list-filter-panel.js'
import type { ThreadSidebarTranslate } from './thread-view-manager.js'

export interface PresetOptionsMenuProps {
  readonly t: ThreadSidebarTranslate
  /** The active preset's name. */
  readonly label: string
  /** The built-in All threads: never renamed, overwritten or deleted (council round 28, item 13). */
  readonly builtIn: boolean
  readonly edited: boolean
  /** Delete is offered while more than one preset exists. */
  readonly canDelete: boolean
  readonly onSaveAs: () => void
  readonly onRename: () => void
  readonly onSaveChanges: () => void
  readonly onDelete: () => void
  readonly onManage: () => void
  /** Mark N shown as read / unread, each present only when it changes a row. */
  readonly markActions: readonly ListFilterAction[]
}

export const PresetOptionsMenu = (props: PresetOptionsMenuProps): JSX.Element => {
  const t = props.t
  const builtInHintId = useId()
  // The edited built-in row already offers Save as new preset… as its button (list-filter-panel.tsx), so the menu shows
  // it once, there (council round 34, A5): no second copy, no caption that explains it, no leading separator.
  const saveAsInRow = props.builtIn && props.edited
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          // Its 16px glyph ends on the panel's 12px inset, the edge Reset's label ends on (round 28, item 16). On a coarse
          // pointer its 44px touch area reaches left (20px) instead of 10px each way, which put 2px past the sheet's edge
          // and scrolled it sideways (council round 29, item 4).
          className="dshx:-mr-1 dshx:text-muted-foreground dshx:pointer-coarse:after:right-0 dshx:pointer-coarse:after:-left-5"
          aria-label={`${t('threadSidebarPresetOptions')}: ${props.label}`}
        >
          <OverflowGlyph />
        </Button>
      </DropdownMenuTrigger>
      {/* A fixed 256px, aligned to the ⋯'s end, so it stays inside the 320px panel (council round 30, item 4). As the sheet
          opened from the Filters sheet on a phone, it pads 12px so its items start at the Filters sheet's 20px text edge
          (council round 32, item 8). */}
      <DropdownMenuContent align="end" className="dshx-root dshx:w-64 dshx:phone:px-3!" aria-label={t('threadSidebarPresetOptions')}>
        {/* The built-in All threads shows no dead rows (council round 29, item 2): one caption says why, and describes
            the one way to keep its changes (a <p> in a menu is skipped unless an item points at it: round 30, item 4). */}
        {props.builtIn && !saveAsInRow ? (
          <p id={builtInHintId} className="dshx:px-2 dshx:pt-1.5 dshx:pb-1 dshx:text-xs dshx:whitespace-normal dshx:text-muted-foreground" data-preset-built-in-hint="">
            {t('threadSidebarPresetBuiltInHint')}
          </p>
        ) : null}
        {/* Save as… left the panel for this menu, so the sheet opens on the filters (round 28, item 10). */}
        {saveAsInRow ? null : (
          <DropdownMenuItem onSelect={props.onSaveAs} aria-describedby={props.builtIn ? builtInHintId : undefined}>
            {/* One verb name, as on the edited built-in row's button (council round 29, item 2). */}
            {t('threadSidebarPresetSaveAsNew')}
          </DropdownMenuItem>
        )}
        {/* One text edge (no verb carries an icon) and the preset's name as a quiet label (council round 28, item 12),
            for a user preset only: the built-in caption already says which. */}
        {props.builtIn ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="dshx:truncate dshx:text-xs dshx:font-normal dshx:text-muted-foreground">{props.label}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={props.onRename}>{t('threadSidebarPresetRename')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!props.edited} onSelect={props.onSaveChanges}>
              {/* One verb name, as on the edited row's button. */}
              {t('threadSidebarPresetSaveChanges', { name: props.label })}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={!props.canDelete} onSelect={props.onDelete}>
              {t('threadSidebarPresetDelete')}
            </DropdownMenuItem>
          </>
        )}
        {saveAsInRow ? null : <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={props.onManage}>{t('threadSidebarPresetManage')}</DropdownMenuItem>
        {/* Last, after a separator, and saying their scope (council round 32, item 4): "Mark 2 shown as read". */}
        {props.markActions.length === 0 ? null : <DropdownMenuSeparator />}
        {props.markActions.map(action => (
          <DropdownMenuItem key={action.id} disabled={action.disabled === true} onSelect={action.onSelect}>
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
