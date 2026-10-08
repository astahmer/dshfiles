import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { test } from 'vitest'
import { DEFAULT_PREFERENCES } from './organization.js'
import { SidebarStateProvider, usePreferences, useSidebarState } from './sidebar-state.js'

const PreferencesProbe = (): JSX.Element => {
  const { preferences, hostBacked } = usePreferences()
  return <output data-host={String(hostBacked)}>{preferences.headerMode}</output>
}

const SidebarProbe = (): JSX.Element => <output>{useSidebarState().preferences.navigationOverflow}</output>

test('preferences render with fallback values outside a DSHX Settings context', () => {
  const html = renderToString(<PreferencesProbe />)
  assert.match(html, /data-host="false"/)
  assert.match(html, new RegExp(`>${DEFAULT_PREFERENCES.headerMode}<`))
})

test('the sidebar state provider renders without a Settings provider', () => {
  const html = renderToString(
    <SidebarStateProvider>
      <SidebarProbe />
    </SidebarStateProvider>,
  )
  assert.match(html, new RegExp(`>${DEFAULT_PREFERENCES.navigationOverflow}<`))
})
