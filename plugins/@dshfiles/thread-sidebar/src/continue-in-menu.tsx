import { useApiQuery } from '@dshfiles/dshx/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComponentType, JSX } from 'react'
import type { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { threadActionsApi } from './thread-actions-api.js'
import type { ThreadReferenceItemProps } from './thread-references-menu.js'

export interface ContinueInProjectItemsProps {
  readonly t: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
  readonly continueIn: (projectId: string) => void
  /** The menu's own item primitive: the header and the context menu use different ones. */
  readonly Item: ComponentType<ThreadReferenceItemProps>
}

/** The registered projects a thread can continue in, fetched when its submenu opens. */
export const ContinueInProjectItems = ({ t, continueIn, Item }: ContinueInProjectItemsProps): JSX.Element => {
  const query = useApiQuery(threadActionsApi, 'projectList', { input: {} })
  if (query.error !== null) return <Item disabled>{t('threadSidebarContinueInProjectsFailed')}</Item>
  if (query.status !== 'success') return <Item disabled>{t('threadSidebarContinueInProjectsLoading')}</Item>
  if (query.data.projects.length === 0) return <Item disabled>{t('threadSidebarContinueInNoProjects')}</Item>
  return (
    <>
      {query.data.projects.map(project => (
        <Item key={project.projectId} onSelect={() => continueIn(project.projectId)}>
          <span className="dshx:min-w-0 dshx:truncate" title={project.path}>
            {project.title}
          </span>
        </Item>
      ))}
    </>
  )
}
