import type { ReactNode } from 'react'
import { joinClassNames } from './field.js'
import styles from './layout.module.css'

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

export interface NoticeProps {
  readonly tone?: NoticeTone
  readonly title?: ReactNode
  readonly actions?: ReactNode
  readonly className?: string
  readonly children?: ReactNode
}

/** Inline message. `danger` and `warning` announce as alerts; the others as status. */
export const Notice = (props: NoticeProps): JSX.Element => {
  const tone = props.tone ?? 'info'
  return (
    <div className={joinClassNames(styles.notice, styles[tone], props.className)} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
      <div className={styles.noticeBody}>
        {props.title !== undefined && <span className={styles.noticeTitle}>{props.title}</span>}
        {props.children}
      </div>
      {props.actions !== undefined && <div className={styles.noticeActions}>{props.actions}</div>}
    </div>
  )
}

export interface EmptyStateProps {
  readonly title?: ReactNode
  readonly description?: ReactNode
  readonly action?: ReactNode
  readonly compact?: boolean
  readonly className?: string
}

export const EmptyState = (props: EmptyStateProps): JSX.Element => (
  <div className={joinClassNames(styles.emptyState, props.compact === true && styles.emptyStateCompact, props.className)}>
    {props.title !== undefined && <p className={styles.emptyTitle}>{props.title}</p>}
    {props.description !== undefined && <p className={styles.emptyDescription}>{props.description}</p>}
    {props.action !== undefined && <div className={styles.emptyAction}>{props.action}</div>}
  </div>
)

export interface SectionProps {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly actions?: ReactNode
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
  readonly children?: ReactNode
}

export const Section = (props: SectionProps): JSX.Element => {
  const Heading = `h${props.headingLevel ?? 3}` as const
  return (
    <section className={joinClassNames(styles.section, props.className)}>
      <header className={styles.sectionHeader}>
        <div className={styles.sectionHeading}>
          <Heading className={styles.sectionTitle}>{props.title}</Heading>
          {props.description !== undefined && <p className={styles.sectionDescription}>{props.description}</p>}
        </div>
        {props.actions !== undefined && <div className={styles.sectionActions}>{props.actions}</div>}
      </header>
      {props.children}
    </section>
  )
}

export const VisuallyHidden = (props: { readonly children: ReactNode }): JSX.Element => <span className={styles.visuallyHidden}>{props.children}</span>
