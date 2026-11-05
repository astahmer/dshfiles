import { useRegistry } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ArrowDownIcon, ArrowUpIcon } from '@dshfiles/plugin-ui/icons'
import { useId, type ReactNode } from 'react'
import { StatusItems, type StatusItem } from './status-strip.ts'
import { StatusStripPreferencesModel } from './status-strip-preferences.ts'
import { useStatusStripSettings, type StatusStripSettings } from './status-strip-settings.ts'

const StatusItemRow = (props: {
  readonly item: StatusItem
  readonly items: readonly StatusItem[]
  readonly first: boolean
  readonly last: boolean
  readonly settings: StatusStripSettings
}): ReactNode => {
  const switchId = useId()
  const { item, settings } = props
  const save = settings.save
  const shown = !settings.preferences.hidden.includes(item.id)
  const move = (direction: 'up' | 'down'): void =>
    save?.(StatusStripPreferencesModel.move({ items: props.items, preferences: settings.preferences, id: item.id, direction }))
  return (
    <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-3 dshx:py-1.5" data-status-setting={item.id}>
      <Switch
        id={switchId}
        checked={shown}
        disabled={save === undefined}
        onCheckedChange={checked => save?.(StatusStripPreferencesModel.setHidden({ preferences: settings.preferences, id: item.id, hidden: !checked }))}
      />
      <Label htmlFor={switchId} className="dshx:min-w-0 dshx:flex-1 dshx:truncate">
        {item.label}
      </Label>
      <Button variant="ghost" size="icon-sm" aria-label={`Move ${item.label} up`} disabled={save === undefined || props.first} onClick={() => move('up')}>
        <ArrowUpIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Move ${item.label} down`} disabled={save === undefined || props.last} onClick={() => move('down')}>
        <ArrowDownIcon />
      </Button>
    </li>
  )
}

const SideList = (props: {
  readonly heading: string | undefined
  readonly side: readonly StatusItem[]
  readonly items: readonly StatusItem[]
  readonly settings: StatusStripSettings
}): ReactNode => {
  if (props.side.length === 0) return null
  return (
    <section className="dshx:flex dshx:flex-col dshx:gap-1">
      {props.heading === undefined ? null : <h3 className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{props.heading}</h3>}
      <ul aria-label={props.heading ?? 'Status bar items'} className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">
        {props.side.map((item, index) => (
          <StatusItemRow key={item.id} item={item} items={props.items} first={index === 0} last={index === props.side.length - 1} settings={props.settings} />
        ))}
      </ul>
    </section>
  )
}

/** The Settings section: every registered status item with a show switch and up/down buttons. */
export const StatusBarSettings = (): ReactNode => {
  const items = useRegistry(StatusItems)
  const settings = useStatusStripSettings()
  const listed = StatusStripPreferencesModel.list(items, settings.preferences)
  const bothSides = listed.global.length > 0 && listed.thread.length > 0
  return (
    <div className="dshx-root dshx:flex dshx:max-w-xl dshx:flex-col dshx:gap-4">
      {settings.error === null ? null : (
        <p role="alert" className="dshx:text-sm dshx:text-destructive">
          {settings.error} Restart DSH to load the status bar settings, then reload this page.
        </p>
      )}
      {items.length === 0 ? (
        <p className="dshx:text-sm dshx:text-muted-foreground">No plugin adds a status bar item. Enable AI accounts, Thread sidebar or HMR gate in Plugins.</p>
      ) : (
        <>
          <SideList heading={bothSides ? 'Left' : undefined} side={listed.global} items={items} settings={settings} />
          <SideList heading={bothSides ? 'Right' : undefined} side={listed.thread} items={items} settings={settings} />
        </>
      )}
    </div>
  )
}
