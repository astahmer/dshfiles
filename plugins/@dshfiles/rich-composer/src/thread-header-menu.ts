import type { MenuActionView, MenuResolution } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { ThreadHeaderMenu, ThreadHeaderMenuAction } from './thread-views.ts'

const toAction = (view: MenuActionView): ThreadHeaderMenuAction => ({
  id: view.id,
  label: view.label,
  ...(view.disabled === true && { disabled: true }),
  ...(view.icon !== undefined && { iconKey: view.icon.key }),
  ...(view.icon?.src !== undefined && { iconSrc: view.icon.src }),
  ...(view.separatorBefore === true && { separatorBefore: true }),
  ...(view.children !== undefined && { children: view.children.map(toAction) }),
})

/**
 * One opening of the Host's `sessionHeader` menu as the plain rows `@dshfiles/rich-composer/thread-views` publishes, so
 * the thread menu that lists them needs neither the menu service nor its types. The rows keep one array per Host
 * snapshot, which is what an external-store reader needs.
 */
export const threadHeaderMenuOf = (resolution: MenuResolution): ThreadHeaderMenu => {
  let source: readonly MenuActionView[] | undefined
  let actions: readonly ThreadHeaderMenuAction[] = []
  return {
    subscribe: listener => resolution.source.subscribe(listener),
    actions: () => {
      const next = resolution.source.getSnapshot()
      if (next !== source) {
        source = next
        actions = next.map(toAction)
      }
      return actions
    },
    select: id => resolution.select(id),
    dispose: () => resolution.dispose(),
  }
}
