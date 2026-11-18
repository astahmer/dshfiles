import { describe, expect, it } from 'vitest'
import { WindowStateModel } from './window-state.js'

const memoryStorage = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) }
}

describe('client-bridge window id', () => {
  it('keeps the id across a reload and gets a new one for any other navigation, a duplicated tab included', () => {
    const storage = memoryStorage()
    const first = WindowStateModel.clientIdFor({ storage, navigation: 'navigate' })
    expect(first).toMatch(/^w-[0-9a-f]{24}$/u)
    expect(WindowStateModel.clientIdFor({ storage, navigation: 'reload' })).toBe(first)
    expect(WindowStateModel.clientIdFor({ storage, navigation: 'back_forward' })).not.toBe(first)
  })

  it('still names the window when storage is refused', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(WindowStateModel.clientIdFor({ storage: refusing, navigation: 'reload' })).toMatch(/^w-/u)
    expect(WindowStateModel.clientIdFor({ storage: undefined, navigation: undefined })).toMatch(/^w-/u)
  })
})
