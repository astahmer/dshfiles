import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from './organization.js'
import { SidebarPreferencesModel } from './preferences.js'
import { RailActionsModel } from './rail-actions-model.js'

const everything = { restartAvailable: true, reloadPending: true, launchUrl: true, pairingAvailable: true }

describe('DSH actions on the rail', () => {
  it('leaves Restart to the status strip by default: one restart control, not a rail button beside it', () => {
    expect(DEFAULT_PREFERENCES.showRailRestart).toBe(false)
    expect(RailActionsModel.shown({ ...everything, preferences: DEFAULT_PREFERENCES })).toEqual(['reload', 'copy-url', 'pair-phone'])
    // The strip item then draws the restart notice and its verbs.
    expect(RailActionsModel.restartOnRail({ preferences: DEFAULT_PREFERENCES, restartAvailable: true })).toBe(false)
  })

  it('puts Restart back on the rail for someone who asks for it, and the strip then draws none', () => {
    const preferences = { ...DEFAULT_PREFERENCES, showRailRestart: true }
    expect(RailActionsModel.shown({ ...everything, preferences })).toEqual(['restart', 'reload', 'copy-url', 'pair-phone'])
    expect(RailActionsModel.restartOnRail({ preferences, restartAvailable: true })).toBe(true)
    expect(RailActionsModel.restartOnRail({ preferences, restartAvailable: false })).toBe(false)
  })

  it('draws nothing while the rail actions are off, and only what has an owner', () => {
    expect(RailActionsModel.shown({ ...everything, preferences: { ...DEFAULT_PREFERENCES, showRailActions: false, showRailRestart: true } })).toEqual([])
    expect(
      RailActionsModel.shown({ restartAvailable: false, reloadPending: false, launchUrl: false, pairingAvailable: true, preferences: DEFAULT_PREFERENCES }),
    ).toEqual(['pair-phone'])
  })

  it('reads settings saved before the choice existed as off, and keeps a saved choice', () => {
    const { showRailRestart, ...older } = DEFAULT_PREFERENCES
    expect(showRailRestart).toBe(false)
    expect(SidebarPreferencesModel.decode(older)?.showRailRestart).toBe(false)
    expect(SidebarPreferencesModel.decode({ ...older, showRailRestart: true })?.showRailRestart).toBe(true)
  })

  it('shows the Developer group by default, reads older settings as shown, and keeps a saved choice to hide it', () => {
    const { showDeveloperPages, ...older } = DEFAULT_PREFERENCES
    expect(showDeveloperPages).toBe(true)
    expect(SidebarPreferencesModel.decode(older)?.showDeveloperPages).toBe(true)
    expect(SidebarPreferencesModel.decode({ ...older, showDeveloperPages: false })?.showDeveloperPages).toBe(false)
  })
})
