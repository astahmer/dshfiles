import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { FieldDescription, FieldLegend, FieldSet } from '@dshfiles/plugin-ui/components/ui/field'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { useId, useState } from 'react'
import type { ThreadSidebarTranslate } from './thread-view-manager.js'
import {
  THREAD_NOTIFICATION_CATEGORIES,
  ThreadNotificationModel,
  type ThreadNotificationCategories,
  type ThreadNotificationCategory,
  type ThreadNotificationDelivery,
  type ThreadNotificationSound,
} from './thread-notifications.js'
import { ThreadNotificationAudioModel } from './thread-notification-audio.js'

export type BrowserNotificationPermission = NotificationPermission | 'unsupported'

export const readBrowserNotificationPermission = (): BrowserNotificationPermission =>
  typeof window === 'undefined' || !('Notification' in window) ? 'unsupported' : window.Notification.permission

const categoryLabelKeys = {
  'approval-needed': 'threadSidebarApprovalNeeded',
  'input-needed': 'threadSidebarInputNeeded',
  'turn-finished': 'threadSidebarTurnFinished',
  stopped: 'threadSidebarStopped',
  failed: 'threadSidebarFailed',
} as const satisfies Record<ThreadNotificationCategory, Parameters<ThreadSidebarTranslate>[0]>

const deliveryLabelKeys = {
  off: 'threadSidebarDeliveryOff',
  'in-app': 'threadSidebarDeliveryInApp',
  system: 'threadSidebarDeliverySystem',
  both: 'threadSidebarDeliveryBoth',
} as const satisfies Record<ThreadNotificationDelivery, Parameters<ThreadSidebarTranslate>[0]>

const soundLabelKeys = {
  soft: 'threadSidebarSoundSoft',
  chime: 'threadSidebarSoundChime',
  bright: 'threadSidebarSoundBright',
  low: 'threadSidebarSoundLow',
} as const satisfies Record<ThreadNotificationSound, Parameters<ThreadSidebarTranslate>[0]>

const permissionLabelKeys = {
  default: 'threadSidebarNotificationsPermissionHint',
  granted: 'threadSidebarNotificationsAllowed',
  denied: 'threadSidebarNotificationsPermission',
  unsupported: 'threadSidebarNotificationsUnavailable',
} satisfies Record<BrowserNotificationPermission, Parameters<ThreadSidebarTranslate>[0]>

const deliveryOptions: readonly ThreadNotificationDelivery[] = ['off', 'in-app', 'system', 'both']
const soundOptions: readonly ThreadNotificationSound[] = ['soft', 'chime', 'bright', 'low']

interface ThreadNotificationSettingsProps {
  readonly categories: ThreadNotificationCategories
  readonly onChange: (categories: ThreadNotificationCategories) => void
  readonly t: ThreadSidebarTranslate
}

export const ThreadNotificationSettings = (props: ThreadNotificationSettingsProps): JSX.Element => {
  const id = useId()
  const [permission, setPermission] = useState(readBrowserNotificationPermission)
  const [audioUnavailable, setAudioUnavailable] = useState(false)
  const hasSystemRoute = THREAD_NOTIFICATION_CATEGORIES.some(category =>
    ThreadNotificationModel.notificationRouteHasSystem(props.categories[category].delivery),
  )

  const updateCategory = (category: ThreadNotificationCategory, patch: Partial<ThreadNotificationCategories[ThreadNotificationCategory]>): void => {
    props.onChange({ ...props.categories, [category]: { ...props.categories[category], ...patch } })
    if (patch.sound === true) void ThreadNotificationAudioModel.unlock().then(available => setAudioUnavailable(!available))
  }

  const requestPermission = async (): Promise<void> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported')
      return
    }
    try {
      setPermission(await window.Notification.requestPermission())
    } catch {
      setPermission(readBrowserNotificationPermission())
    }
  }

  const previewSound = async (category: ThreadNotificationCategory): Promise<void> => {
    const preference = props.categories[category]
    setAudioUnavailable(!(await ThreadNotificationAudioModel.preview(preference.soundPreset, preference.volume)))
  }

  return (
    <FieldSet className="dshx:gap-3">
      <FieldLegend>{props.t('threadSidebarNotifications')}</FieldLegend>
      <FieldDescription>{props.t('threadSidebarNotificationPrivacy')}</FieldDescription>
      <FieldDescription>{props.t('threadSidebarSoundScopeHint')}</FieldDescription>
      {audioUnavailable ? (
        <Alert variant="warning">
          <AlertDescription>{props.t('threadSidebarAudioUnavailable')}</AlertDescription>
        </Alert>
      ) : null}
      {THREAD_NOTIFICATION_CATEGORIES.map(category => {
        const preference = props.categories[category]
        const label = props.t(categoryLabelKeys[category])
        const deliveryId = `${id}-${category}-delivery`
        const soundId = `${id}-${category}-sound`
        const presetId = `${id}-${category}-preset`
        const volumeId = `${id}-${category}-volume`
        return (
          <div key={category} className="dshx:grid dshx:min-w-0 dshx:gap-2 dshx:border-t dshx:pt-2">
            <span className="dshx:text-xs dshx:font-medium">{label}</span>
            <div className="dshx:grid dshx:grid-cols-2 dshx:items-end dshx:@max-pane-narrow:grid-cols-1 dshx:gap-2">
              <div className="dshx:grid dshx:min-w-0 dshx:gap-1">
                <Label htmlFor={deliveryId} className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
                  {props.t('threadSidebarDelivery')}
                </Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      id={deliveryId}
                      size="sm"
                      type="button"
                      variant="outline"
                      className="dshx:min-w-0 dshx:justify-start"
                      aria-label={`${label}: ${props.t(deliveryLabelKeys[preference.delivery])}`}
                    >
                      {props.t(deliveryLabelKeys[preference.delivery])}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuRadioGroup
                      value={preference.delivery}
                      onValueChange={value => {
                        const delivery = deliveryOptions.find(option => option === value)
                        if (delivery !== undefined) updateCategory(category, { delivery })
                      }}
                    >
                      {deliveryOptions.map(delivery => (
                        <DropdownMenuRadioItem key={delivery} value={delivery}>
                          {props.t(deliveryLabelKeys[delivery])}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Label htmlFor={soundId} className="dshx:justify-self-start dshx:font-normal">
                <Checkbox
                  id={soundId}
                  aria-label={`${label}: ${props.t('threadSidebarNotificationSound')}`}
                  checked={preference.sound}
                  onCheckedChange={checked => updateCategory(category, { sound: checked === true })}
                />
                {props.t('threadSidebarNotificationSound')}
              </Label>
            </div>
            {preference.sound ? (
              <div className="dshx:grid dshx:grid-cols-2 dshx:items-end dshx:@max-pane-narrow:grid-cols-1 dshx:gap-2">
                <div className="dshx:grid dshx:min-w-0 dshx:gap-1">
                  <Label htmlFor={presetId} className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
                    {props.t('threadSidebarSoundPreset')}
                  </Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        id={presetId}
                        size="sm"
                        type="button"
                        variant="outline"
                        className="dshx:min-w-0 dshx:justify-start"
                        aria-label={`${label} ${props.t('threadSidebarSoundPreset')}: ${props.t(soundLabelKeys[preference.soundPreset])}`}
                      >
                        {props.t(soundLabelKeys[preference.soundPreset])}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuRadioGroup
                        value={preference.soundPreset}
                        onValueChange={value => {
                          const soundPreset = soundOptions.find(option => option === value)
                          if (soundPreset !== undefined) updateCategory(category, { soundPreset })
                        }}
                      >
                        {soundOptions.map(soundPreset => (
                          <DropdownMenuRadioItem key={soundPreset} value={soundPreset}>
                            {props.t(soundLabelKeys[soundPreset])}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="dshx:grid dshx:gap-1">
                  <Label htmlFor={volumeId} className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
                    {props.t('threadSidebarNotificationVolume')}: {Math.round(preference.volume * 100)}%
                  </Label>
                  <Input
                    id={volumeId}
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={preference.volume}
                    onChange={event => updateCategory(category, { volume: Number(event.currentTarget.value) })}
                  />
                </div>
                <Button size="sm" type="button" variant="outline" className="dshx:justify-self-start" onClick={() => void previewSound(category)}>
                  {props.t('threadSidebarPreviewSound')}
                </Button>
              </div>
            ) : null}
          </div>
        )
      })}
      {hasSystemRoute ? (
        <div className="dshx:grid dshx:gap-1">
          <span className="dshx:text-xs dshx:font-medium">{props.t('threadSidebarSystemNotifications')}</span>
          {permission === 'default' ? (
            <Button size="sm" type="button" variant="outline" className="dshx:justify-start" onClick={() => void requestPermission()}>
              {props.t('threadSidebarAllowSystemNotifications')}
            </Button>
          ) : null}
          <p className="dshx:text-xs dshx:text-muted-foreground">{props.t(permissionLabelKeys[permission])}</p>
        </div>
      ) : null}
    </FieldSet>
  )
}
