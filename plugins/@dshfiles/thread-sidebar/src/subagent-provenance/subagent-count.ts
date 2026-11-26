import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { plural } from '@dshfiles/dshx/client'
import type { WorkCountWords } from '@dshfiles/plugin-ui/lib/work-count'
import type { ThreadSidebarLocaleKey } from '../locales.js'

/**
 * This plugin's words for the one count formula (`@dshfiles/plugin-ui/lib/work-count`, council round 22 item 3), so
 * the header chip, the list's detail line and the transcript group read the same `6 working · 2 failed`.
 * @param translate - the thread-sidebar namespace's translator.
 * @param include - the optional parts this surface shows: `calls` only where every call is listed, `done`/`stopped`
 *   where finished ones matter.
 */
export const subagentCountWords = (
  translate: Translate<ThreadSidebarLocaleKey>,
  include: { readonly calls?: boolean; readonly settled?: boolean } = {},
): WorkCountWords => ({
  working: count => translate('threadSidebarWorkingCount', { count }),
  failed: count => translate('threadSidebarFailedCount', { count }),
  calls: include.calls === true ? count => plural(translate, 'subagentCountCalls', count) : undefined,
  stopped: include.settled === true ? count => translate('subagentCountStopped', { count }) : undefined,
  done: include.settled === true ? count => translate('subagentCountDone', { count }) : undefined,
})
