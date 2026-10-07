import {
  Button,
  IconFlatListOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Modal,
  StateDot,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ConfirmDialog, EmptyState, Notice, Section } from '@dshfiles/plugin-ui'
import { useMemo, useState, type ReactNode } from 'react'
import type { ServerDraft, ServerView } from './api.js'
import { filterProviders } from './catalog.js'
import type { McpServersTranslate } from './locales.js'
import { ServerEditor } from './server-editor.js'
import { blankServerForm, serverFormFromView, type ServerFormValues } from './server-form.js'
import { useRegistrySearch, useServerActions, useServerSnapshot } from './server-queries.js'
import { credentialReferenceSummary, isClientActive, isConnectionToggleBlocked, lifecycleDotState, lifecycleText, localProcessText } from './server-status.js'
import styles from './manager.module.css'

const REGISTRY_URL = 'https://registry.modelcontextprotocol.io/'

interface EditorState {
  readonly key: number
  readonly values: ServerFormValues
}

export const ManagerDialog = (props: { readonly t: McpServersTranslate; readonly open: boolean; readonly onClose: () => void }): JSX.Element => (
  <Modal
    className={styles.managerDialog}
    closeLabel={props.t('close')}
    contentClassName={styles.managerDialogContent}
    onClose={props.onClose}
    open={props.open}
    title={props.t('title')}
  >
    <ManagerView t={props.t} />
  </Modal>
)

export const ManagerView = ({ t }: { readonly t: McpServersTranslate }): JSX.Element => {
  const snapshot = useServerSnapshot()
  const actions = useServerActions()
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<ServerView | null>(null)
  const [query, setQuery] = useState('')
  const [submittedRegistryQuery, setSubmittedRegistryQuery] = useState('')
  const registry = useRegistrySearch(submittedRegistryQuery)
  const trimmedQuery = query.trim()
  const servers = snapshot.data?.servers ?? []
  const filteredProviders = useMemo(() => filterProviders(snapshot.data?.providers ?? [], query), [snapshot.data, query])
  const registryResults = submittedRegistryQuery === trimmedQuery && registry.isSuccess ? registry.data : []
  const showsNoRegistryResults = submittedRegistryQuery === trimmedQuery && trimmedQuery.length > 0 && registry.isSuccess && registry.data.length === 0

  const openEditor = (values: ServerFormValues): void => {
    actions.resetErrors()
    setEditor(current => ({ key: (current?.key ?? 0) + 1, values }))
  }
  const save = async (draft: ServerDraft): Promise<void> => {
    if (await actions.save(draft)) setEditor(null)
  }
  const confirmRemoval = (): void => {
    if (pendingRemoval === null) return
    actions.remove({ server: pendingRemoval, onSettled: () => setPendingRemoval(null) })
  }
  const searchRegistry = (): void => {
    if (trimmedQuery.length === 0) return
    setSubmittedRegistryQuery(trimmedQuery)
    if (submittedRegistryQuery === trimmedQuery) void registry.refetch()
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <div className={styles.actions}>
          <Button disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()} variant="outline">
            {t('refresh')}
          </Button>
          <Button icon={<IconPlusOutlineRegular />} onClick={() => openEditor(blankServerForm({ name: t('custom') }))} variant="primary">
            {t('add')}
          </Button>
        </div>
      </header>
      {snapshot.isError || actions.failed || registry.isError ? <Notice tone="danger">{t('error')}</Notice> : null}

      {editor ? <ServerEditor defaultValues={editor.values} key={editor.key} onCancel={() => setEditor(null)} onSave={save} t={t} /> : null}

      <Section
        actions={<Tag tone="neutral">{snapshot.data ? servers.length : '…'}</Tag>}
        className={styles.section}
        headingLevel={2}
        title={t('configuredServers')}
      >
        {servers.length > 0 ? (
          <div className={styles.serverList}>
            {servers.map(server => (
              <ServerCard
                busy={actions.isPending}
                key={server.id}
                onEdit={() => openEditor(serverFormFromView(server))}
                onRemove={() => setPendingRemoval(server)}
                onToggleConnection={() => actions.toggleConnection(server)}
                onToggleEnabled={() => actions.toggleEnabled(server)}
                server={server}
                t={t}
              />
            ))}
          </div>
        ) : (
          <EmptyState className={styles.empty} description={t('empty')} />
        )}
      </Section>

      <Section className={styles.section} description={t('registryDisclaimer')} headingLevel={2} title={t('browse')}>
        <div className={styles.searchRow}>
          <Input
            aria-label={t('search')}
            className={styles.searchInput}
            onChange={event => setQuery(event.currentTarget.value)}
            placeholder={t('search')}
            value={query}
          />
          <Button disabled={registry.isFetching || trimmedQuery.length === 0} onClick={searchRegistry} variant="outline">
            {registry.isFetching ? '…' : t('searchRegistry')}
          </Button>
        </div>
        <div className={styles.catalogGrid}>
          {filteredProviders.map(provider => (
            <CatalogCard
              action={
                <Button onClick={() => openEditor(blankServerForm({ name: provider.name }))} size="sm" variant="outline">
                  {t('configure')}
                </Button>
              }
              category={provider.category}
              description={provider.description}
              docsUrl={provider.docsUrl}
              key={provider.id}
              t={t}
              title={provider.name}
            />
          ))}
          {registryResults.map((entry, index) => (
            <CatalogCard
              action={
                <Button
                  onClick={() => openEditor(blankServerForm({ name: entry.title || entry.name, endpoint: entry.endpoint ?? '' }))}
                  size="sm"
                  variant="outline"
                >
                  {t('addFromCatalog')}
                </Button>
              }
              category={entry.category}
              description={entry.description || entry.version}
              docsUrl={entry.docsUrl}
              key={`${entry.name}-${entry.version}-${index}`}
              t={t}
              title={entry.title || entry.name}
            />
          ))}
        </div>
        {showsNoRegistryResults ? <EmptyState compact description={t('noRegistryResults')} /> : null}
        <div className={styles.registryFooter}>
          <span>{t('registryDisclaimer')}</span>
          <a href={REGISTRY_URL} rel="noreferrer" target="_blank">
            {t('registry')}
          </a>
        </div>
      </Section>

      <ConfirmDialog
        busy={actions.isRemoving}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        confirmLabel={t('remove')}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={confirmRemoval}
        open={pendingRemoval !== null}
        title={t('confirmRemove')}
        tone="danger"
      />
    </div>
  )
}

interface ServerCardProps {
  readonly t: McpServersTranslate
  readonly server: ServerView
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onToggleConnection: () => void
  readonly onToggleEnabled: () => void
  readonly onRemove: () => void
}

const ServerCard = ({ t, server, ...props }: ServerCardProps): JSX.Element => {
  const processText = localProcessText(server, t)
  return (
    <article className={styles.serverCard}>
      <div className={styles.serverMain}>
        <div className={styles.glyph}>
          <IconFlatListOutlineRegular size={18} />
        </div>
        <div className={styles.serverCopy}>
          <strong>{server.name}</strong>
          <span>{server.transport === 'stdio' ? server.commandLine : server.url}</span>
          <span className={styles.tags}>
            <Tag tone={server.enabled ? 'success' : 'neutral'}>{server.enabled ? t('enabled') : t('disabled')}</Tag>
            <Tag tone={server.configuration === 'ready' ? 'success' : 'warning'}>{server.configuration === 'ready' ? t('ready') : t('needsCredentials')}</Tag>
          </span>
          <span className={styles.status}>
            <StateDot state={lifecycleDotState(server)} />
            {lifecycleText(server, t)} · {server.registeredToolCount} {t('registeredTools')}
          </span>
          {processText ? <span>{processText}</span> : null}
          <span>{t('connectionUnknown')}</span>
          {server.credentialReferences.length > 0 ? (
            <span>
              {t('references')}: {credentialReferenceSummary(server)}
            </span>
          ) : null}
        </div>
      </div>
      <div className={styles.serverActions}>
        <Button onClick={props.onEdit} size="sm">
          {t('edit')}
        </Button>
        <Button disabled={props.busy || isConnectionToggleBlocked(server)} onClick={props.onToggleConnection} size="sm">
          {isClientActive(server) ? t('disconnect') : t('connect')}
        </Button>
        <Button disabled={props.busy} onClick={props.onToggleEnabled} size="sm" variant="outline">
          {server.enabled ? t('disable') : t('enable')}
        </Button>
        <Button aria-label={t('remove')} disabled={props.busy} icon={<IconTrashOutlineRegular />} onClick={props.onRemove} size="sm" />
      </div>
    </article>
  )
}

interface CatalogCardProps {
  readonly t: McpServersTranslate
  readonly title: string
  readonly category: string
  readonly description: string
  readonly docsUrl: string | null
  readonly action: ReactNode
}

const CatalogCard = (props: CatalogCardProps): JSX.Element => (
  <article className={styles.catalogCard}>
    <div className={styles.glyph}>
      <IconFlatListOutlineRegular size={22} />
    </div>
    <div className={styles.catalogCopy}>
      <div className={styles.catalogTitle}>
        <strong>{props.title}</strong>
        <Tag tone="neutral">{props.category}</Tag>
      </div>
      <p>{props.description}</p>
      <div className={styles.catalogActions}>
        {props.docsUrl ? (
          <a href={props.docsUrl} rel="noreferrer" target="_blank">
            {props.t('docs')}
          </a>
        ) : null}
        {props.action}
      </div>
    </div>
  </article>
)
