import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImageGalleryScope } from '../../chat-settings.ts'
import { PreferenceRow } from './PreferenceRow.tsx'

export interface ImageGalleryScopeRowInjected {
  hooks: {
    imageGalleryScope: ObservableSnapshot<ImageGalleryScope>
  }
  setImageGalleryScope: (scope: ImageGalleryScope) => void
}

export type ImageGalleryScopeRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<ImageGalleryScopeRowInjected>

export const ImageGalleryScopeRow = ({ useImageGalleryScope, setImageGalleryScope, t }: ImageGalleryScopeRowProps) => {
  const scope = useImageGalleryScope(value => value)
  return (
    <PreferenceRow
      title={t('settings.imageGallery.title')}
      description={t('settings.imageGallery.description')}
      value={scope}
      selectedLabel={t(scope === 'turn' ? 'settings.imageGallery.turn' : 'settings.imageGallery.thread')}
      options={[
        { id: 'turn', label: t('settings.imageGallery.turn') },
        { id: 'thread', label: t('settings.imageGallery.thread') },
      ]}
      onSelect={(value) => {
        if (value === 'turn' || value === 'thread') setImageGalleryScope(value)
      }}
    />
  )
}
