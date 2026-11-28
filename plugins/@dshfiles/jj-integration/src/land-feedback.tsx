import type { LandResult, ThreadRevisionView } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'

const LISTED_REVISIONS = 3
const DESCRIPTION_LENGTH = 48

const revisionLabel = (revision: ThreadRevisionView): string => {
  const description = revision.description.length > DESCRIPTION_LENGTH ? `${revision.description.slice(0, DESCRIPTION_LENGTH - 1)}…` : revision.description
  return `${revision.changeId.slice(0, 8)} ${description}`.trim()
}

/** Revisions a land refused for want of a description, counted: the confirmation dialog lists them by id. */
export const undescribedText = (t: JjIntegrationTranslate, count: number): string =>
  count === 1 ? t('needsDescriptionOne') : t('needsDescriptionMany', { count })

export const describeLandResult = (t: JjIntegrationTranslate, result: LandResult): string => {
  if (result.status === 'landed') {
    const listed = result.revisions.slice(0, LISTED_REVISIONS).map(revisionLabel)
    const hidden = result.revisions.length - listed.length
    const revisions = hidden > 0 ? `${listed.join(', ')} ${t('andMore', { count: hidden })}` : listed.join(', ')
    const rebased = t(result.revisions.length === 1 ? 'rebasedOne' : 'rebasedMany', { count: result.revisions.length, bookmark: result.bookmark, revisions })
    const summary =
      result.head === undefined
        ? rebased
        : `${rebased} ${t('bookmarkNowAt', { bookmark: result.bookmark, changeId: result.head.changeId.slice(0, 8), commitId: result.head.commitId.slice(0, 8) })}`
    return result.warning === undefined ? summary : `${summary} ${result.warning}`
  }
  const summary =
    result.status === 'nothing-to-land'
      ? t('nothingToRebase', { bookmark: result.bookmark })
      : result.status === 'needs-description'
        ? undescribedText(t, result.revisions.length)
        : t('rebaseConflicted', { bookmark: result.bookmark, files: result.files.join(', ') })
  return result.agentAsked ? `${summary} ${t('agentAskedToRebase')}` : summary
}

/**
 * What a thread's Land reports in a toast (round three item 27): nothing for a clean land, which the header's
 * "✓ Landed" and the transcript marker already confirm without covering the header; the warning alone for a land that
 * left one; and why it stopped otherwise.
 */
export const landResultToast = (t: JjIntegrationTranslate, result: LandResult): string | undefined => {
  if (result.status !== 'landed') return describeLandResult(t, result)
  return result.warning
}

/** Rebase rewrote the repository: the jujutsu plugin's changes card and chips listen for this to refetch. */
export { announceRepositoryChange } from './repository-change.js'
