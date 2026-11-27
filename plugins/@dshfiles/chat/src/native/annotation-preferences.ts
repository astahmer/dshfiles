/** Inline annotation shape and quick-add preference, live immediately and reconciled with accepted Host settings. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  ANNOTATION_MARKS_FIELD, ANNOTATION_QUICK_COMMENT_FIELD, DEFAULT_ANNOTATION_MARKS,
  DEFAULT_ANNOTATION_QUICK_COMMENT, type AnnotationMarks, type AnnotationQuickComment, type ChatSettings,
} from '../chat-settings.ts'

/** The transcript shape annotations take: markers with a popover, a comments column, an inline thread or nothing. */
export class AnnotationMarksPolicy {
  private readonly unsubscribe: () => void
  readonly marks = createSnapshotStore<AnnotationMarks>(DEFAULT_ANNOTATION_MARKS)

  /** @param host - Chat settings scope persisted through the Host. */
  constructor(private readonly host: ConfigForm<ChatSettings>) {
    const adopt = (): void => {
      const accepted = host.getSnapshot().value?.annotationMarks
      if (accepted !== undefined) this.marks.set(accepted)
    }
    this.unsubscribe = host.subscribe(adopt)
    adopt()
  }

  /** Release the accepted-value subscription. */
  dispose(): void { this.unsubscribe() }

  /**
   * Publish a shape immediately and queue its Host write.
   * @param marks - shape chosen by the user.
   */
  setMarks(marks: AnnotationMarks): void {
    if (marks === this.marks.getSnapshot()) return
    this.marks.set(marks)
    void this.host.set(ANNOTATION_MARKS_FIELD, marks).catch(() => {})
  }
}

/** Whether Annotate asks for the comment at the selection or attaches the passage silently. */
export class AnnotationQuickCommentPolicy {
  private readonly unsubscribe: () => void
  readonly quickComment = createSnapshotStore<AnnotationQuickComment>(DEFAULT_ANNOTATION_QUICK_COMMENT)

  /** @param host - Chat settings scope persisted through the Host. */
  constructor(private readonly host: ConfigForm<ChatSettings>) {
    const adopt = (): void => {
      const accepted = host.getSnapshot().value?.annotationQuickComment
      if (accepted !== undefined) this.quickComment.set(accepted)
    }
    this.unsubscribe = host.subscribe(adopt)
    adopt()
  }

  /** Release the accepted-value subscription. */
  dispose(): void { this.unsubscribe() }

  /**
   * Publish a choice immediately and queue its Host write.
   * @param quickComment - how the next Annotate press behaves.
   */
  setQuickComment(quickComment: AnnotationQuickComment): void {
    if (quickComment === this.quickComment.getSnapshot()) return
    this.quickComment.set(quickComment)
    void this.host.set(ANNOTATION_QUICK_COMMENT_FIELD, quickComment).catch(() => {})
  }
}
