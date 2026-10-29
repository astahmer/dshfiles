import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@dshfiles/plugin-ui/components/ui/context-menu'
import { CopyIcon, PanelRightOpenIcon } from '@dshfiles/plugin-ui/icons'
import { requestThreadMentionInsertion, ThreadMentionDrag } from '@dshfiles/thread-sidebar/thread-mention'
import { workbenchPanels } from '@dshfiles/workbench/registry'
import { useSyncExternalStore, type ReactElement } from 'react'
import type { MainTabsTranslate } from './locales.js'
import { requestPanelAside } from './panel-aside.js'
import { requestThreadAside } from './thread-aside.js'
import { requestThreadSettle } from './settle-request.js'
import { buildThreadTabLink } from './thread-link.js'
import type { TabView } from './workbench-tabs.js'
import type { TabsEvent } from './tabs-machine.js'

/** The native menu shared by the strip and Dockview; no second action implementation. */
export const TabMenuItems = (props: {
  readonly tab: TabView
  readonly tabs: readonly TabView[]
  readonly send: (event: TabsEvent) => void
  readonly t: MainTabsTranslate
  readonly onRename: () => void
  readonly onStatus?: ((message: string) => void) | undefined
  /** Dockview supplies its semantic move action; the native strip retains independent-pane opening. */
  readonly moveAside?: ((tabId: string) => boolean) | undefined
}): ReactElement => {
  const { tab, tabs, send, t, onRename } = props
  const index = tabs.findIndex(candidate => candidate.id === tab.id)
  const registry = workbenchPanels()
  useSyncExternalStore(registry.subscribe, registry.list, registry.list)
  const pluginPanels = registry.listContextMenuPanels()
  const report = (message: string): void => props.onStatus?.(message)
  const copy = async (value: string, copiedKey: 'threadIdCopied' | 'threadLinkCopied'): Promise<void> => {
    try {
      report(t((await writeClipboard(value)) ? copiedKey : 'clipboardFailure'))
    } catch {
      report(t('clipboardFailure'))
    }
  }
  const openSelectedAside = (): void => {
    const requestAside = (): boolean => {
      if (props.moveAside !== undefined) return props.moveAside(tab.id)
      if (tab.kind === 'thread') return requestThreadAside(tab.sessionId)
      if (tab.kind === 'panel') return requestPanelAside(tab.panelId)
      return false
    }
    const accepted = requestAside()
    // The native strip's panel request was historically silent when unavailable.
    if (!accepted && (props.moveAside !== undefined || tab.kind === 'thread')) report(t('sidePanelUnavailable'))
  }
  return (
    <>
      {tab.kind === 'start' ? null : (
        <ContextMenuItem onSelect={() => send({ type: 'tab.togglePin', tabId: tab.id })}>{t(tab.pinned ? 'unpin' : 'pin')}</ContextMenuItem>
      )}
      {tab.preview ? <ContextMenuItem onSelect={() => send({ type: 'tab.keep', tabId: tab.id })}>{t('keepOpen')}</ContextMenuItem> : null}
      {tab.kind === 'thread' ? <ContextMenuItem onSelect={() => onRename()}>{t('renameThread')}</ContextMenuItem> : null}
      {tab.kind === 'start' && !tab.preview ? null : <ContextMenuSeparator />}
      {tab.kind === 'panel' ? (
        <>
          <ContextMenuItem onSelect={openSelectedAside}>
            <PanelRightOpenIcon aria-hidden="true" />
            {t('openInSidePanel')}
          </ContextMenuItem>
          {pluginPanels.length > 0 ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>{t('openPluginInSidePanel')}</ContextMenuSubTrigger>
              <ContextMenuSubContent className="dshx-root dshx:min-w-44">
                {pluginPanels.map(definition => (
                  <ContextMenuItem key={definition.id} onSelect={() => requestPanelAside(definition.id)}>
                    {definition.title}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
        </>
      ) : null}
      {tab.kind === 'thread' ? (
        <>
          {pluginPanels.length > 0 ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>{t('openPluginInSidePanel')}</ContextMenuSubTrigger>
              <ContextMenuSubContent className="dshx-root dshx:min-w-44">
                {pluginPanels.map(definition => (
                  <ContextMenuItem key={definition.id} onSelect={() => requestPanelAside(definition.id)}>
                    {definition.title}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
          <ContextMenuItem onSelect={() => requestThreadMentionInsertion(tab.sessionId, ThreadMentionDrag.activeComposerSessionId())}>
            {t('mentionThread')}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t('threadStatus')}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="dshx-root dshx:min-w-44">
              <ContextMenuItem disabled={tab.status === 'running'} onSelect={() => requestThreadSettle(tab.sessionId)}>
                {t('settleThread')}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onSelect={openSelectedAside}>
            <PanelRightOpenIcon aria-hidden="true" />
            {t('openInSidePanel')}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t('copy')}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="dshx-root dshx:min-w-44">
              <ContextMenuItem onSelect={() => void copy(tab.sessionId, 'threadIdCopied')}>
                <CopyIcon aria-hidden="true" />
                {t('copyThreadId')}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() =>
                  void copy(
                    buildThreadTabLink({
                      currentUrl: window.location.href,
                      sessionId: tab.sessionId,
                      workspaceId: tab.workspaceId,
                    }),
                    'threadLinkCopied',
                  )
                }
              >
                <CopyIcon aria-hidden="true" />
                {t('copyThreadLink')}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
        </>
      ) : null}
      <ContextMenuItem onSelect={() => send({ type: 'tab.close', tabId: tab.id })}>{t('closeTab')}</ContextMenuItem>
      <ContextMenuItem disabled={tabs.length < 2} onSelect={() => send({ type: 'tab.closeOthers', tabId: tab.id })}>
        {t('closeOthers')}
      </ContextMenuItem>
      <ContextMenuItem disabled={index === tabs.length - 1} onSelect={() => send({ type: 'tab.closeToRight', tabId: tab.id })}>
        {t('closeToRight')}
      </ContextMenuItem>
    </>
  )
}
