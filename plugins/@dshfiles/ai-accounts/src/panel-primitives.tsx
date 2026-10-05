import type { ReactNode } from 'react'
import styles from './accounts.module.css'

export const Field = (props: { readonly label: string; readonly hint?: string; readonly children: JSX.Element }): JSX.Element => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{props.label}</span>
    {props.children}
    {props.hint === undefined ? null : <span className={styles.fieldHint}>{props.hint}</span>}
  </label>
)

/** One numbered section header, the shape the reference page numbers 01–05. */
export const Section = (props: {
  readonly index: string
  readonly title: string
  readonly action?: JSX.Element | null
  readonly muted?: string
  readonly children: ReactNode
}): JSX.Element => (
  <section className={styles.section}>
    <div className={styles.sectionHead}>
      <div className={styles.sectionHeadTitle}>
        <span className={styles.sectionIndex}>{props.index}</span>
        <h3>{props.title}</h3>
      </div>
      {props.action ?? null}
      {props.muted === undefined ? null : <span className={styles.sectionMuted}>{props.muted}</span>}
    </div>
    <p className={styles.help}>{props.children}</p>
  </section>
)
