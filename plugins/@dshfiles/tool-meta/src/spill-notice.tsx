import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { FileTextIcon } from '@dshfiles/plugin-ui/icons'

/**
 * Core's spill notice (`@deepseek-ai/dsh-spill-policy`), written for the model at the end of a cut output:
 * `(Omitted 14463 bytes. Full formatted result stored at: /…/bash.txt. Use read with offset/limit, or grep …)`.
 */
const SPILL_NOTICE = /\(Omitted (\d+) bytes\. Full formatted result stored at: (\S+?)\.\s+Use read\b[^)]*\)\s*$/u

export interface SpillFacts {
  /** Where core stored the full output. */
  readonly path: string
  /** What the card shows, in bytes, without the notice. */
  readonly shownBytes: number
  readonly omittedBytes: number
}

/** The stored path and the sizes, when the output ends with core's spill notice. */
export const spillNoticeOf = (text: string): SpillFacts | undefined => {
  const match = SPILL_NOTICE.exec(text)
  if (match === null) return undefined
  const [, omitted = '0', path = ''] = match
  return { path, shownBytes: new TextEncoder().encode(text.slice(0, match.index)).length, omittedBytes: Number(omitted) }
}

const sizeText = (bytes: number): string =>
  bytes < 1024 ? `${String(bytes)} bytes` : bytes < 1024 * 1024 ? `${String(Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

const outputText = (owner: ToolCallOwnerProps): string =>
  owner.phase === 'result' ? owner.block.content.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n') : ''

/**
 * Round four item 28: one line under a card whose output DSH cut and stored, with a way to the whole output. Core's
 * notice stays in the output (it is the model's instruction); this line is the person's.
 */
export const SpillNotice = ({ owner }: { readonly owner: ToolCallOwnerProps }): JSX.Element | null => {
  const spill = owner.phase === 'result' ? spillNoticeOf(outputText(owner)) : undefined
  if (spill === undefined) return null
  return (
    <p className="dshx-root dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:px-1 dshx:text-xs dshx:text-muted-foreground" data-tool-spill="">
      <span>{`Showing the last ${sizeText(spill.shownBytes)} of the output.`}</span>
      <Button className="dshx:h-auto dshx:p-0 dshx:text-xs" onClick={() => owner.openFile(spill.path)} size="xs" type="button" variant="link">
        <FileTextIcon aria-hidden />
        Open full output
      </Button>
    </p>
  )
}
