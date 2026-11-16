/** Localized titles for projected step-process activity. */
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ProcessActivitySummary } from '../contract/process-groups.ts'

/**
 * Compose a closed group's localized title from its top three categories without counts.
 * @param summary - ranked work and phase evidence for this range.
 * @param t - Chat namespace translator.
 * @returns the secondary disclosure title.
 */
export function processTitle(
  summary: ProcessActivitySummary,
  t: ChatViewSlotProps['t'],
): string {
  const labels = summary.counts.slice(0, 3).map(({ kind }) => t(`message.stepProcess.done.${kind}`))
  const first = labels[0]
  if (first === undefined) return t('message.stepProcess.done.thinking')
  const continuation = (label: string): string => label.charAt(0).toLowerCase() + label.slice(1)
  const second = labels[1]
  if (second === undefined) return first
  if (labels.length === 2) {
    const prefix = t('message.stepProcess.sharedPrefix')
    const shared = prefix !== '' && first.startsWith(prefix) && second.startsWith(prefix)
    return t('message.stepProcess.joinTwo', { first, second: continuation(shared ? second.slice(prefix.length) : second) })
  }
  const title = [first, ...labels.slice(1).map(continuation)].join(t('message.stepProcess.comma'))
  return summary.counts.length > 3 ? t('message.stepProcess.more', { title }) : title
}

/**
 * dshfiles (unslop T4): whether a process group draws its own collapsible header.
 *
 * A finished Turn that folds behind its "Worked for" row already has its disclosure: a second header inside it meant
 * two clicks to reach one list. Such a group renders its rows flat, and the header stays for the groups nothing else
 * folds: a running Turn in Summary, and a Turn that stays open (failed, stopped, input in the middle).
 * @param input.stepGrouping - the view mode's grouping: every Turn, finished Turns only, or none.
 * @param input.turnOpen - whether the group's Turn is still running.
 * @param input.deferCollapse - whether the latest finished Turn stays flat until the next input.
 * @param input.turnFolds - whether the Turn's own "Worked for" row hides and shows this group.
 * @returns whether the group shows a header that collapses its rows.
 */
export function groupOwnsHeader(input: {
  readonly stepGrouping: 'collapsed' | 'history' | 'none'
  readonly turnOpen: boolean
  readonly deferCollapse: boolean
  readonly turnFolds: boolean
}): boolean {
  if (input.turnFolds) return false
  return input.stepGrouping === 'collapsed' || (input.stepGrouping === 'history' && !input.turnOpen && !input.deferCollapse)
}
