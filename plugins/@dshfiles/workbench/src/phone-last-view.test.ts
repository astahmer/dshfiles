import { describe, expect, it } from 'vitest'
import { PhoneRightPaneModel } from './phone-last-view.js'

const chooser = 'dshfiles-workbench.new-view/1'
const available = (id: string): boolean => id === 'changes'

describe('PhoneRightPaneModel.resumePanel', () => {
  it('resumes the remembered view when a chooser is active', () => {
    expect(PhoneRightPaneModel.resumePanel({ activeId: chooser, lastId: 'changes', available })).toBe('changes')
  })

  it('leaves an explicitly opened view alone', () => {
    expect(PhoneRightPaneModel.resumePanel({ activeId: 'changes', lastId: 'traces', available })).toBeUndefined()
  })

  it('does not resume a view the dock no longer holds', () => {
    expect(PhoneRightPaneModel.resumePanel({ activeId: chooser, lastId: 'closed-panel', available })).toBeUndefined()
    expect(PhoneRightPaneModel.resumePanel({ activeId: chooser, lastId: undefined, available })).toBeUndefined()
  })
})
