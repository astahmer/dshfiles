import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { describeSettingsTargets } from './settings-index.js'

/** The shared `settings.describe` mirror and the searchable fields derived from it. */
export const useSettingsMirror = (describe: SettingsDescribeFace) => {
  const mirror = useSyncExternalStore(
    useCallback(listener => describe.subscribe(listener), [describe]),
    useCallback(() => describe.getSnapshot(), [describe]),
    useCallback(() => describe.getSnapshot(), [describe]),
  )
  useEffect(() => {
    void describe.ensure()
  }, [describe])
  const namespaces = mirror.view?.namespaces ?? []
  const results = useMemo(() => describeSettingsTargets(namespaces), [namespaces])
  return { mirror, namespaces, results }
}
