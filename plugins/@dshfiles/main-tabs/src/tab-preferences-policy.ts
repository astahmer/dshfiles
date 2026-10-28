import type { MainSurfaceMode } from '@dshfiles/frame-layout/regions'
import type { TabPreferences } from './tabs-machine.js'

/** Derive surface behavior without changing the user's saved native-tab preferences. */
export const effectiveTabPreferences = (preferences: TabPreferences, mode: MainSurfaceMode): TabPreferences =>
  mode === 'workbench' ? { ...preferences, enabled: true, keepConversations: true, keepScope: true } : preferences
