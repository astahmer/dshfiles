import type { LandResult, ThreadRevisionView } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'

const LISTED_REVISIONS = 3
const DESCRIPTION_LENGTH = 48

const revisionLabel = (revision: ThreadRevisionView): string => {
  const description = revision.description.length > DESCRIPTION_LENGTH ? `${revision.description.slice(0, DESCRIPTION_LENGTH - 1)}…` : revision.description
  return `${revision.changeId.slice(0, 8)} ${description}`.trim()
}

export const describeLandResult = (t: JjIntegrationTranslate, result: LandResult): string => {
  if (result.status === 'landed') {
    const listed = result.revisions.slice(0, LISTED_REVISIONS).map(revisionLabel)
    const hidden = result.revisions.length - listed.length
    const revisions = hidden > 0 ? `${listed.join(', ')} ${t('andMore', { count: hidden })}` : listed.join(', ')
    const rebased = t('rebased', { count: result.revisions.length, bookmark: result.bookmark, revisions })
    return result.head === undefined
      ? rebased
      : `${rebased} ${t('bookmarkNowAt', { bookmark: result.bookmark, changeId: result.head.changeId.slice(0, 8), commitId: result.head.commitId.slice(0, 8) })}`
  }
  const summary =
    result.status === 'nothing-to-land'
      ? t('nothingToRebase', { bookmark: result.bookmark })
      : result.status === 'needs-description'
        ? t('needsDescription', { revisions: result.revisions.map(revision => revision.changeId).join(', ') })
        : t('rebaseConflicted', { bookmark: result.bookmark, files: result.files.join(', ') })
  return result.agentAsked ? `${summary} ${t('agentAskedToRebase')}` : summary
}

/** Rebase rewrote the repository: the jujutsu plugin's changes card and chips listen for this to refetch. */
export const announceRepositoryChange = (): void => {
  window.dispatchEvent(new CustomEvent('dshfiles:jj-changed'))
}
