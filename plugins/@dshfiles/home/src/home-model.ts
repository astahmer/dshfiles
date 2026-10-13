import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HomeSettings } from './settings.js'

const THREADS_DIRECTORY_SUFFIX = '-threads'

/** A jj-integration thread workspace lives at `<project>-threads/<name>`; it belongs to `<project>`. */
export const projectOf = (workspace: WorkspaceView, items: readonly WorkspaceView[]): WorkspaceView => {
  const parent = workspace.path.slice(0, workspace.path.lastIndexOf('/'))
  if (!parent.endsWith(THREADS_DIRECTORY_SUFFIX)) return workspace
  return items.find(item => item.path === parent.slice(0, -THREADS_DIRECTORY_SUFFIX.length)) ?? workspace
}

export const brandStyle = (settings: HomeSettings): string =>
  [
    '[class$="_fishHitbox"]{width:auto}',
    settings.headline.trim() === '' ? '' : '[class$="_titleGroup"]>span:first-child{display:none}',
    settings.showPreviewBadge ? '' : '[class$="_previewBadge"]{display:none}',
    settings.showAgentPresetPicker ? '' : '[data-slot="conversation.hero.agentPreset"]{display:none!important}',
  ].join('')

