import { describe, expect, it } from 'vitest'
import { brandStyle, projectOf } from './home-model.js'
import { isNewThreadScreen } from './new-thread-screen.js'
import { homeSettings } from './settings.js'

const workspace = (path: string) => ({ workspaceId: path, path, title: path, sessionIds: [], createdAt: '', updatedAt: '' }) as never

describe('home model', () => {
  it('files a thread workspace under its project and leaves other workspaces alone', () => {
    const project = workspace('/repo')
    const thread = workspace('/repo-threads/thread-1')
    const other = workspace('/elsewhere/thing')
    expect(projectOf(thread, [project, thread, other])).toBe(project)
    expect(projectOf(other, [project, thread, other])).toBe(other)
  })

  it('keeps the strip on the New thread screen only', () => {
    expect(isNewThreadScreen({ blank: true, running: false, promptAttempted: false }, true)).toBe(true)
    expect(isNewThreadScreen({ blank: true, running: true, promptAttempted: true }, true)).toBe(false)
    expect(isNewThreadScreen({ blank: true, running: false, promptAttempted: true }, true)).toBe(false)
    expect(isNewThreadScreen({ blank: false, running: false, promptAttempted: true }, true)).toBe(false)
  })

  it('waits for the Session list to call the Session blank before treating the screen as new', () => {
    const opening = { blank: true, running: false, promptAttempted: false }
    expect(isNewThreadScreen(opening, false)).toBe(false)
    expect(isNewThreadScreen(opening, true)).toBe(true)
  })

  it('hides only the native pieces the settings replace', () => {
    const defaults = homeSettings.schema({})
    expect(brandStyle(defaults)).toContain('_titleGroup')
    expect(brandStyle(defaults)).toContain('_composerStack')
    expect(brandStyle(defaults)).toContain('_previewBadge')
    expect(brandStyle(defaults)).not.toContain('agentPreset')
    expect(brandStyle({ ...defaults, headline: '', showPreviewBadge: true, showAgentPresetPicker: false })).toBe(
      '[class$="_fishHitbox"]{width:auto}[class$="_composerStack"]>[data-slot="conversation.input.dock"]{order:1}[data-slot="conversation.hero.agentPreset"]{display:none!important}',
    )
  })
})
