import { Button, IconCloseOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { EmptyState, Notice } from '@dshfiles/plugin-ui'
import { useState, useSyncExternalStore } from 'react'
import type { McpServersTranslate } from './locales.js'
import { ManagerDialog } from './manager-view.js'
import type { QuickPanelState } from './quick-panel.js'
import { useServerActions, useServerSnapshot } from './server-queries.js'
import { isClientActive, isConnectionToggleBlocked, lifecycleDotState, lifecycleText, localProcessText, matchesServerSearch } from './server-status.js'
import styles from './manager.module.css'

export const McpQuickPanel = ({ t, panel }: { readonly t: McpServersTranslate; readonly panel: QuickPanelState }): JSX.Element => {
  const open = useSyncExternalStore(panel.subscribe, panel.getSnapshot)
  const [manage, setManage] = useState(false)
  const openManager = (): void => {
    setManage(true)
    panel.close()
  }
  return (
    <>
      {open ? <QuickPanelContent onClose={() => panel.close()} onManage={openManager} t={t} /> : null}
      <ManagerDialog onClose={() => setManage(false)} open={manage} t={t} />
    </>
  )
}

interface QuickPanelContentProps {
  readonly t: McpServersTranslate
  readonly onClose: () => void
  readonly onManage: () => void
}

const QuickPanelContent = ({ t, ...props }: QuickPanelContentProps): JSX.Element => {
  const snapshot = useServerSnapshot()
  const actions = useServerActions()
  const [search, setSearch] = useState('')
  const servers = snapshot.data?.servers ?? []
  const matchingServers = servers.filter(server => matchesServerSearch(server, search))

  return (
    <div aria-label={t('title')} className={styles.quickPanel} role="dialog">
      <div className={styles.quickHeader}>
        <strong>{t('title')}</strong>
        <Button aria-label={t('close')} icon={<IconCloseOutlineRegular />} onClick={props.onClose} size="sm" />
      </div>
      <Input aria-label={t('quickPanelSearch')} onChange={event => setSearch(event.currentTarget.value)} placeholder={t('quickPanelSearch')} value={search} />
      {servers.length === 0 ? (
        <EmptyState compact description={t('empty')} />
      ) : matchingServers.length === 0 ? (
        <EmptyState compact description={t('quickPanelNoResults')} />
      ) : (
        matchingServers.map(server => (
          <div className={styles.quickRow} key={server.id}>
            <div className={styles.quickInfo}>
              <strong>{server.name}</strong>
              <span className={styles.status}>
                <StateDot state={lifecycleDotState(server)} />
                {server.enabled ? t('enabled') : t('disabled')} · {lifecycleText(server, t)} · {server.registeredToolCount} {t('registeredTools')}
              </span>
              {localProcessText(server, t) ? <span>{localProcessText(server, t)}</span> : null}
              <span>{t('connectionUnknown')}</span>
            </div>
            <div className={styles.quickActions}>
              <Button
                disabled={actions.isPending || isConnectionToggleBlocked(server)}
                onClick={() => actions.toggleConnection(server)}
                size="sm"
              >
                {isClientActive(server) ? t('disconnect') : t('connect')}
              </Button>
              <Button disabled={actions.isPending} onClick={() => actions.toggleEnabled(server)} size="sm">
                {server.enabled ? t('disable') : t('enable')}
              </Button>
            </div>
          </div>
        ))
      )}
      {snapshot.isError || actions.failed ? <Notice tone="danger">{t('error')}</Notice> : null}
      <div className={styles.quickFooter}>
        <Button aria-label={t('refresh')} disabled={snapshot.isFetching} icon={<IconRefreshOutlineRegular />} onClick={() => void snapshot.refetch()} size="sm" />
        <Button onClick={props.onManage} size="sm">
          {t('manage')}
        </Button>
        <Button icon={<IconPlusOutlineRegular />} onClick={props.onManage} size="sm" variant="primary">
          {t('add')}
        </Button>
      </div>
    </div>
  )
}
