/**
 * Where the inbox sends the user for a subject kind it cannot open itself. Published as the
 * `@dshfiles/activity-timeline/attention-openers` dshx module, so a provider imports this token and none of the inbox
 * runtime: the inbox shows Open on an item whose subject kind has an opener, and never assumes one exists.
 */
import { defineRegistry } from '@dshfiles/dshx/client'
import type { AttentionSubject, AttentionSubjectKind } from './attention-api.js'

export interface AttentionSubjectOpener {
  /** The subject kind this page opens; one opener per kind. */
  readonly subjectKind: AttentionSubjectKind
  /** Sentence case, lower case first letter: names what opens in the item's menu and tooltip ("backlog item"). */
  readonly label: string
  /** Open the subject's own page; false when it is gone, so the inbox can say what to do instead. */
  readonly open: (subject: AttentionSubject) => boolean
}

export const AttentionSubjectOpeners = defineRegistry<AttentionSubjectOpener>('@dshfiles/activity-timeline.subject-opener')
