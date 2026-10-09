import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Alert } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@dshfiles/plugin-ui/components/ui/field'
import { Kbd, KbdGroup } from '@dshfiles/plugin-ui/components/ui/kbd'
import { useState, useSyncExternalStore } from 'react'
import { DEFAULT_PREFERENCES } from './organization.js'
import { chordFromEvent, formatChord, isMacPlatform, parseChord, sameAsHostBinding, serializeChord } from './keyboard-shortcuts.js'
import type { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { usePreferences } from './sidebar-state.js'

type Translate = TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>

interface SettingsTabProps {
  readonly t: Translate
  readonly hostShortcuts: ObservableSnapshot<readonly ShortcutCatalogEntry[]>
}

/** Capture order: when two actions share a chord, the one listed first wins. */
const CHORD_KEYS = ['paletteChord', 'fileSearchChord', 'threadSearchChord', 'backChord', 'forwardChord'] as const
type ChordKey = (typeof CHORD_KEYS)[number]

export const SettingsTab = (props: SettingsTabProps): JSX.Element => {
  const { preferences, updatePreferences, storageWarning } = usePreferences()
  const hostShortcuts = useSyncExternalStore(props.hostShortcuts.subscribe, props.hostShortcuts.getSnapshot)
  const [recording, setRecording] = useState<ChordKey | null>(null)
  const mac = isMacPlatform(navigator.platform)

  const chordRow = (key: ChordKey, label: string): JSX.Element => {
    const chord = parseChord(preferences[key])
    const hostOwned = chord !== null && hostShortcuts.some(entry => sameAsHostBinding(chord, entry.binding, mac))
    const duplicate = chord !== null && CHORD_KEYS.slice(0, CHORD_KEYS.indexOf(key)).some(earlier => preferences[earlier] === preferences[key])
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
            <Button
              size="sm"
              variant="outline"
              className="dshx:min-w-32"
              onClick={() => setRecording(key)}
              aria-label={`${props.t('threadSidebarRecord')}: ${label}`}
            >
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
          <Button
            size="sm"
            variant="ghost"
            disabled={preferences[key] === DEFAULT_PREFERENCES[key]}
            onClick={() => updatePreferences({ [key]: DEFAULT_PREFERENCES[key] })}
          >
            {props.t('threadSidebarChordReset')}
          </Button>
        </div>
      </Field>
    )
  }

  return (
    <div className="dshx-root dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-6 dshx:overflow-auto dshx:pb-6">
      {storageWarning ? <Alert variant="warning">{props.t('threadSidebarStorageFailure')}</Alert> : null}
      <FieldSet>
        <FieldLegend>{props.t('threadSidebarKeyboardSection')}</FieldLegend>
        <FieldDescription>{props.t('threadSidebarChordHint')}</FieldDescription>
        <FieldGroup className="dshx:gap-4">
          {chordRow('paletteChord', props.t('threadSidebarPaletteChord'))}
          {chordRow('fileSearchChord', props.t('threadSidebarFileSearchChord'))}
          {chordRow('threadSearchChord', props.t('threadSidebarThreadSearchChord'))}
          {chordRow('backChord', props.t('threadSidebarNavigateBack'))}
          {chordRow('forwardChord', props.t('threadSidebarNavigateForward'))}
        </FieldGroup>
      </FieldSet>
    </div>
  )
}
