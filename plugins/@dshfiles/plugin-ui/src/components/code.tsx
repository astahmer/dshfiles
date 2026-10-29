import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'

export interface CodeProps {
  readonly code: string
  /** A fence info string or a language id; unknown languages render as plain text. */
  readonly lang?: string
  readonly lineNumbers?: boolean
  /** False hides the language and copy header. */
  readonly header?: boolean
  readonly copyLabel?: string
  readonly copiedLabel?: string
  readonly className?: string
}

/** The Host highlighted code block with English copy labels. */
export const Code = (props: CodeProps): JSX.Element => (
  <CodeBlock
    code={props.code}
    lang={props.lang}
    lineNumbers={props.lineNumbers ?? false}
    showHeader={props.header ?? true}
    copyLabel={props.copyLabel ?? 'Copy'}
    copiedLabel={props.copiedLabel ?? 'Copied'}
    className={props.className}
  />
)
