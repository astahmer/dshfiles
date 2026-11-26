/** Inline annotation shape preference: gutter markers with a popover, a comments column, an inline thread or nothing. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ANNOTATION_MARKS, type AnnotationMarks } from '../../chat-settings.ts'
import { PreferenceRow } from './PreferenceRow.tsx'

export interface AnnotationMarksRowInjected {
  hooks: {
    annotationMarks: ObservableSnapshot<AnnotationMarks>
  }
  setAnnotationMarks: (marks: AnnotationMarks) => void
}

type Translate = PropsLocale<'chat'>['t']
type ChatKey = Parameters<Translate>[0]

const LABELS: Record<AnnotationMarks, ChatKey> = {
  popover: 'settings.annotationMarks.popover',
  hover: 'settings.annotationMarks.hover',
  column: 'settings.annotationMarks.column',
  inline: 'settings.annotationMarks.inline',
  off: 'settings.annotationMarks.off',
}

export type AnnotationMarksRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<AnnotationMarksRowInjected>

export const AnnotationMarksRow = ({ useAnnotationMarks, setAnnotationMarks, t }: AnnotationMarksRowProps) => {
  const marks = useAnnotationMarks(value => value)
  return (
    <PreferenceRow
      title={t('settings.annotationMarks.title')}
      description={t('settings.annotationMarks.description')}
      value={marks}
      selectedLabel={t(LABELS[marks])}
      options={ANNOTATION_MARKS.map(marks => ({ id: marks, label: t(LABELS[marks]) }))}
      onSelect={(value) => {
        const accepted = ANNOTATION_MARKS.find(marks => marks === value)
        if (accepted !== undefined) setAnnotationMarks(accepted)
      }}
    />
  )
}
