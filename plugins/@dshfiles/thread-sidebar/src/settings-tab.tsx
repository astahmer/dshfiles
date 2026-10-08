import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Alert } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@dshfiles/plugin-ui/components/ui/field'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Kbd, KbdGroup } from '@dshfiles/plugin-ui/components/ui/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { useId, useState, useSyncExternalStore } from 'react'
import { DEFAULT_PREFERENCES, type SidebarPreferences } from './organization.js'
import { chordFromEvent, formatChord, isMacPlatform, parseChord, sameAsHostBinding, serializeChord } from './palette.js'
import type { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { usePreferences } from './sidebar-state.js'

type Translate = TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>

interface SettingsTabProps {
  readonly t: Translate
  readonly hostShortcuts: ObservableSnapshot<readonly ShortcutCatalogEntry[]>
}

type ChordKey = 'paletteChord' | 'threadSearchChord'

const isOneOf = <Value extends string>(values: readonly Value[], value: string): value is Value => values.some(candidate => candidate === value)

export const SettingsTab = (props: SettingsTabProps): JSX.Element => {
  const { preferences, updatePreferences, storageWarning } = usePreferences()
  const hostShortcuts = useSyncExternalStore(props.hostShortcuts.subscribe, props.hostShortcuts.getSnapshot)
  const [recording, setRecording] = useState<ChordKey | null>(null)
  const id = useId()
  const mac = isMacPlatform(navigator.platform)

  const numberField = (key: 'idleMinutes' | 'scanIntervalMinutes' | 'paletteRecentLimit', minimum: number, maximum: number, label: string): JSX.Element => (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={`${id}-${key}`} className="dshx:font-normal">
        {label}
      </FieldLabel>
      <Input
        id={`${id}-${key}`}
        type="number"
        className="dshx:h-8 dshx:w-24"
        min={minimum}
        max={maximum}
        value={preferences[key]}
        onChange={event => {
          const value = Number(event.currentTarget.value)
          if (Number.isInteger(value) && value >= minimum && value <= maximum) updatePreferences({ [key]: value })
        }}
      />
    </Field>
  )

  const chordRow = (key: ChordKey, label: string): JSX.Element => {
    const chord = parseChord(preferences[key])
    const hostOwned = chord !== null && hostShortcuts.some(entry => sameAsHostBinding(chord, entry.binding, mac))
    const duplicate = chord !== null && key === 'threadSearchChord' && preferences.paletteChord === preferences.threadSearchChord
    return (
      <Field orientation="horizontal" className="dshx:items-start">
        <FieldContent>
          <FieldLabel className="dshx:font-normal">{label}</FieldLabel>
          {hostOwned ? <FieldDescription className="dshx:text-warning">{props.t('threadSidebarChordHostConflict')}</FieldDescription> : null}
          {duplicate ? <FieldDescription className="dshx:text-warning">{props.t('threadSidebarChordDuplicate')}</FieldDescription> : null}
        </FieldContent>
        <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5">
          {recording === key ? (
            <Button
              autoFocus
              size="sm"
              variant="outline"
              className="dshx:min-w-32 dshx:border-ring"
              onBlur={() => setRecording(null)}
              onKeyDown={event => {
                event.preventDefault()
                event.stopPropagation()
                if (event.key === 'Escape') {
                  setRecording(null)
                  return
                }
                const recorded = chordFromEvent(event, mac)
                if (recorded === null) return
                updatePreferences({ [key]: serializeChord(recorded) })
                setRecording(null)
              }}
            >
              {props.t('threadSidebarRecording')}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="dshx:min-w-32" onClick={() => setRecording(key)} aria-label={`${props.t('threadSidebarRecord')}: ${label}`}>
              {chord === null ? (
                <span className="dshx:text-muted-foreground">{props.t('threadSidebarChordDisabled')}</span>
              ) : (
                <KbdGroup>
                  {formatChord(chord, mac).map(part => (
                    <Kbd key={part}>{part}</Kbd>
                  ))}
                </KbdGroup>
              )}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={preferences[key] === null} onClick={() => updatePreferences({ [key]: null })}>
            {props.t('threadSidebarChordDisable')}
          </Button>
          <Button size="sm" variant="ghost" disabled={preferences[key] === DEFAULT_PREFERENCES[key]} onClick={() => updatePreferences({ [key]: DEFAULT_PREFERENCES[key] })}>
            {props.t('threadSidebarChordReset')}
          </Button>
        </div>
      </Field>
    )
  }

  const selectRow = <Value extends string>(options: {
    key: 'headerMode' | 'navigationDensity' | 'navigationOverflow'
    label: string
    description?: string
    value: Value
    values: readonly Value[]
    labels: Record<Value, string>
    patch: (value: Value) => Partial<SidebarPreferences>
  }): JSX.Element => (
    <Field orientation="horizontal" className="dshx:items-start">
      <FieldContent>
        <FieldLabel htmlFor={`${id}-${options.key}`} className="dshx:font-normal">
          {options.label}
        </FieldLabel>
        {options.description === undefined ? null : <FieldDescription>{options.description}</FieldDescription>}
      </FieldContent>
      <Select
        value={options.value}
        onValueChange={value => {
          if (isOneOf(options.values, value)) updatePreferences(options.patch(value))
        }}
      >
        <SelectTrigger id={`${id}-${options.key}`} size="sm" className="dshx:w-44 dshx:shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="dshx-root">
          {options.values.map(value => (
            <SelectItem key={value} value={value}>
              {options.labels[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )

  return (
    <div className="dshx-root dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-6 dshx:overflow-auto dshx:pb-6">
      {storageWarning ? <Alert variant="warning">{props.t('threadSidebarStorageFailure')}</Alert> : null}
      <FieldSet>
        <FieldLegend>{props.t('threadSidebarNavigationSection')}</FieldLegend>
        <FieldGroup className="dshx:gap-4">
          {selectRow({
            key: 'headerMode',
            label: props.t('threadSidebarHeaderStyle'),
            description: props.t('threadSidebarHeaderStyleHint'),
            value: preferences.headerMode,
            values: ['compact', 'expanded'],
            labels: { compact: props.t('threadSidebarCompact'), expanded: props.t('threadSidebarExpanded') },
            patch: headerMode => ({ headerMode, headerRegionHeight: null }),
          })}
          {selectRow({
            key: 'navigationDensity',
            label: props.t('threadSidebarDensity'),
            value: preferences.navigationDensity,
            values: ['compact', 'comfortable'],
            labels: { compact: props.t('threadSidebarDensityCompact'), comfortable: props.t('threadSidebarDensityComfortable') },
            patch: navigationDensity => ({ navigationDensity }),
          })}
          {selectRow({
            key: 'navigationOverflow',
            label: props.t('threadSidebarOverflow'),
            description: props.t('threadSidebarOverflowHint'),
            value: preferences.navigationOverflow,
            values: ['scroll', 'menu', 'scroll-menu'],
            labels: { scroll: props.t('threadSidebarOverflowScroll'), menu: props.t('threadSidebarOverflowMenu'), 'scroll-menu': props.t('threadSidebarOverflowBoth') },
            patch: navigationOverflow => ({ navigationOverflow }),
          })}
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>{props.t('threadSidebarKeyboardSection')}</FieldLegend>
        <FieldDescription>{props.t('threadSidebarChordHint')}</FieldDescription>
        <FieldGroup className="dshx:gap-4">
          {chordRow('paletteChord', props.t('threadSidebarPaletteChord'))}
          {chordRow('threadSearchChord', props.t('threadSidebarThreadSearchChord'))}
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>{props.t('threadSidebarPaletteSection')}</FieldLegend>
        <FieldGroup className="dshx:gap-4">{numberField('paletteRecentLimit', 5, 100, props.t('threadSidebarRecentLimit'))}</FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>{props.t('threadSidebarSettings')}</FieldLegend>
        <FieldDescription>{props.t('threadSidebarTimestampNote')}</FieldDescription>
        <FieldGroup className="dshx:gap-4">
          <Field orientation="horizontal">
            <FieldLabel htmlFor={`${id}-auto-archive`} className="dshx:font-normal">
              {props.t('threadSidebarAutoArchive')}
            </FieldLabel>
            <Switch id={`${id}-auto-archive`} checked={preferences.autoArchiveEnabled} onCheckedChange={checked => updatePreferences({ autoArchiveEnabled: checked })} />
          </Field>
          {numberField('idleMinutes', 15, 10080, props.t('threadSidebarIdleAfter'))}
          {numberField('scanIntervalMinutes', 1, 120, props.t('threadSidebarScanEvery'))}
        </FieldGroup>
      </FieldSet>
    </div>
  )
}
