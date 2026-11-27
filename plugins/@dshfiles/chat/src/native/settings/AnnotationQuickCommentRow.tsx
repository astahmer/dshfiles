/** Quick-add preference: Annotate opens the comment box at the selection, or attaches the passage silently. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ANNOTATION_QUICK_COMMENTS, type AnnotationQuickComment } from '../../chat-settings.ts'
import { PreferenceRow } from './PreferenceRow.tsx'

export interface AnnotationQuickCommentRowInjected {
  hooks: {
    annotationQuickComment: ObservableSnapshot<AnnotationQuickComment>
  }
  setAnnotationQuickComment: (quickComment: AnnotationQuickComment) => void
}

type ChatKey = Parameters<PropsLocale<'chat'>['t']>[0]

const LABELS: Record<AnnotationQuickComment, ChatKey> = {
  inline: 'settings.annotationQuickComment.inline',
  attach: 'settings.annotationQuickComment.attach',
}

export type AnnotationQuickCommentRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<AnnotationQuickCommentRowInjected>

export const AnnotationQuickCommentRow = ({ useAnnotationQuickComment, setAnnotationQuickComment, t }: AnnotationQuickCommentRowProps) => {
  const quickComment = useAnnotationQuickComment(value => value)
  return (
    <PreferenceRow
      title={t('settings.annotationQuickComment.title')}
      description={t('settings.annotationQuickComment.description')}
      value={quickComment}
      selectedLabel={t(LABELS[quickComment])}
      options={ANNOTATION_QUICK_COMMENTS.map(quickComment => ({ id: quickComment, label: t(LABELS[quickComment]) }))}
      onSelect={(value) => {
        const accepted = ANNOTATION_QUICK_COMMENTS.find(quickComment => quickComment === value)
        if (accepted !== undefined) setAnnotationQuickComment(accepted)
      }}
    />
  )
}
