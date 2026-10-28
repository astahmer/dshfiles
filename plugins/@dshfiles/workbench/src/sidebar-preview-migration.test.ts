import { describe, expect, it, vi } from 'vitest'
import { SidebarPreviewMigration } from './sidebar-preview-migration.js'

const storage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

describe('ordinary sidebar preview migration', () => {
  it('seats an old fixed preview once and does not resurrect an explicitly closed regular view', () => {
    const memory = storage()
    const place = vi.fn()
    SidebarPreviewMigration.create(() => memory).seat({ alreadyPlaced: () => false, place })
    expect(place).toHaveBeenCalledTimes(1)
    // A second instance models reload after the user deliberately closed it.
    SidebarPreviewMigration.create(() => memory).seat({ alreadyPlaced: () => false, place })
    expect(place).toHaveBeenCalledTimes(1)
  })

  it('respects an existing placement in any current or saved root or nested layout', () => {
    const memory = storage()
    const place = vi.fn()
    const migration = SidebarPreviewMigration.create(() => memory)
    migration.seat({ alreadyPlaced: () => true, place })
    migration.seat({ alreadyPlaced: () => false, place })
    expect(place).not.toHaveBeenCalled()
  })

  it('allows an explicit full layout reset to restore the default preview again', () => {
    const memory = storage()
    const place = vi.fn()
    const migration = SidebarPreviewMigration.create(() => memory)
    migration.seat({ alreadyPlaced: () => true, place })
    migration.reset()
    migration.seat({ alreadyPlaced: () => false, place })
    expect(place).toHaveBeenCalledTimes(1)
  })

  it('does not mark a failed placement complete', () => {
    const memory = storage()
    const migration = SidebarPreviewMigration.create(() => memory)
    expect(() =>
      migration.seat({
        alreadyPlaced: () => false,
        place: () => {
          throw new Error('Owner is not ready')
        },
      }),
    ).toThrow('Owner is not ready')
    const place = vi.fn()
    migration.seat({ alreadyPlaced: () => false, place })
    expect(place).toHaveBeenCalledTimes(1)
  })
})
