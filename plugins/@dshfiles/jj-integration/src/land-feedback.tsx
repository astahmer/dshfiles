import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState } from 'react'
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
    const landed = t('landed', { count: result.revisions.length, bookmark: result.bookmark, revisions })
    return result.head === undefined
      ? landed
      : `${landed} ${t('bookmarkNowAt', { bookmark: result.bookmark, changeId: result.head.changeId.slice(0, 8), commitId: result.head.commitId.slice(0, 8) })}`
  }
  const summary =
    result.status === 'nothing-to-land'
      ? t('nothingToLand', { bookmark: result.bookmark })
      : result.status === 'needs-description'
        ? t('needsDescription', { revisions: result.revisions.map(revision => revision.changeId).join(', ') })
        : t('conflicted', { bookmark: result.bookmark, files: result.files.join(', ') })
  return result.agentAsked ? `${summary} ${t('agentAsked')}` : summary
}

/** Land rewrote the repository: the jujutsu plugin's changes card and chips listen for this to refetch. */
export const announceRepositoryChange = (): void => {
  window.dispatchEvent(new CustomEvent('dshfiles:jj-changed'))
}

/** One transient banner per owner; a new report replaces the one on screen. */
export const useLandToast = () => {
  const [toast, setToast] = useState<{ readonly sequence: number; readonly text: string; readonly success: boolean } | null>(null)
  const show = (input: { readonly text: string; readonly success: boolean }): void =>
    setToast(previous => ({ sequence: (previous?.sequence ?? 0) + 1, text: input.text, success: input.success }))
  const element =
    toast === null ? null : (
      <Toast
        key={toast.sequence}
        text={toast.text}
        holdMs={toast.success ? 6_000 : 9_000}
        tone={toast.success ? 'success' : undefined}
        onDone={() => setToast(current => (current?.sequence === toast.sequence ? null : current))}
      />
    )
  return { show, element }
}
