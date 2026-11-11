import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { UnreadLanding } from '../../chat-settings.ts'
import { PreferenceRow } from './PreferenceRow.tsx'

export interface UnreadLandingRowInjected {
  hooks: {
    unreadLanding: ObservableSnapshot<UnreadLanding>
  }
  setUnreadLanding: (landing: UnreadLanding) => void
}

export type UnreadLandingRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<UnreadLandingRowInjected>

export const UnreadLandingRow = ({ useUnreadLanding, setUnreadLanding, t }: UnreadLandingRowProps) => {
  const landing = useUnreadLanding(value => value)
  return (
    <PreferenceRow
      title={t('settings.unreadLanding.title')}
      description={t('settings.unreadLanding.description')}
      value={landing}
      selectedLabel={t(landing === 'final-answer' ? 'settings.unreadLanding.finalAnswer' : 'settings.unreadLanding.bottom')}
      options={[
        { id: 'final-answer', label: t('settings.unreadLanding.finalAnswer') },
        { id: 'bottom', label: t('settings.unreadLanding.bottom') },
      ]}
      onSelect={(value) => {
        if (value === 'final-answer' || value === 'bottom') setUnreadLanding(value)
      }}
    />
  )
}
