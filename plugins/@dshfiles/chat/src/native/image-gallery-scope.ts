import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_IMAGE_GALLERY_SCOPE, IMAGE_GALLERY_SCOPE_FIELD,
  type ChatSettings, type ImageGalleryScope,
} from '../chat-settings.ts'

export class ImageGalleryScopePolicy {
  private readonly unsubscribe: () => void
  readonly scope = createSnapshotStore<ImageGalleryScope>(DEFAULT_IMAGE_GALLERY_SCOPE)

  constructor(private readonly host: ConfigForm<ChatSettings>) {
    const adopt = (): void => {
      const accepted = host.getSnapshot().value?.imageGalleryScope
      if (accepted !== undefined) this.scope.set(accepted)
    }
    this.unsubscribe = host.subscribe(adopt)
    adopt()
  }

  dispose(): void { this.unsubscribe() }

  setScope(scope: ImageGalleryScope): void {
    if (scope === this.scope.getSnapshot()) return
    this.scope.set(scope)
    void this.host.set(IMAGE_GALLERY_SCOPE_FIELD, scope).catch(() => {})
  }
}
