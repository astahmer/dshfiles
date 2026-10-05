import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FormEvent, ReactNode } from 'react'
import { joinClassNames } from './field.js'
import styles from './layout.module.css'

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly title: string
  readonly description?: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  readonly closeLabel: string
  readonly tone?: 'default' | 'danger'
  /** Disables both actions while the confirmed work is in flight. */
  readonly busy?: boolean
  /** Disables only the confirm action, e.g. while the body's form is invalid. */
  readonly confirmDisabled?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
  readonly children?: ReactNode
}

/**
 * Confirmation over the Host `Modal`, so focus, Escape, layering, and shortcut
 * scope match every native dialog. The body is a form: Enter in a field confirms.
 */
export const ConfirmDialog = (props: ConfirmDialogProps): JSX.Element | null => {
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (props.busy !== true && props.confirmDisabled !== true) props.onConfirm()
  }
  return (
    <Modal
      closeLabel={props.closeLabel}
      onClose={() => {
        if (props.busy !== true) props.onCancel()
      }}
      open={props.open}
      title={props.title}
      {...(props.description === undefined ? {} : { description: props.description })}
    >
      <form className={styles.dialogBody} onSubmit={submit}>
        {props.children}
        <div className={styles.dialogActions}>
          <Button disabled={props.busy} onClick={props.onCancel} type="button" variant="outline">
            {props.cancelLabel}
          </Button>
          <Button
            className={joinClassNames(props.tone === 'danger' && styles.dangerButton)}
            data-modal-autofocus={props.children === undefined ? true : undefined}
            disabled={props.busy === true || props.confirmDisabled === true}
            type="submit"
            variant="primary"
          >
            {props.confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
