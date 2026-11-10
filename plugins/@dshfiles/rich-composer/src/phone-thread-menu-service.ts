import { createContext } from 'react'
import type { PhoneMenuSnapshot, PhoneThreadMenuService } from './phone-thread-menu.tsx'

export const createPhoneThreadMenu = (): PhoneThreadMenuService => {
  let snapshot: PhoneMenuSnapshot = { readers: [], tools: [], launcherReader: null, openReader: null, closeReason: 'dismiss' }
  const listeners = new Set<() => void>()
  let opener: { readonly readerId: string; readonly focus: () => boolean } | undefined
  const publish = (next: PhoneMenuSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const close = (): void => {
    if (snapshot.openReader !== null) publish({ ...snapshot, openReader: null, closeReason: 'dismiss' })
  }
  return {
    scope: createContext<string | null>(null),
    state: {
      get: () => snapshot,
      subscribe: listener => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    registerReader: reader => {
      publish({ ...snapshot, readers: [...snapshot.readers, reader] })
      return () => {
        if (opener?.readerId === reader.id) opener = undefined
        publish({
          ...snapshot,
          readers: snapshot.readers.filter(item => item !== reader),
          launcherReader: snapshot.launcherReader === reader.id ? null : snapshot.launcherReader,
          openReader: snapshot.openReader === reader.id ? null : snapshot.openReader,
        })
      }
    },
    registerTool: tool => {
      publish({ ...snapshot, tools: [...snapshot.tools, tool] })
      return () => publish({ ...snapshot, tools: snapshot.tools.filter(item => item !== tool) })
    },
    attachLauncher: readerId => {
      publish({ ...snapshot, launcherReader: readerId })
      return () => {
        if (snapshot.launcherReader !== readerId) return
        publish({ ...snapshot, launcherReader: null, openReader: null, closeReason: 'dismiss' })
      }
    },
    toggle: (readerId, returnFocus) => {
      if (!snapshot.readers.some(reader => reader.id === readerId)) return
      if (returnFocus !== undefined) opener = { readerId, focus: returnFocus }
      publish({ ...snapshot, openReader: snapshot.openReader === readerId ? null : readerId, closeReason: 'dismiss' })
    },
    returnFocus: readerId => {
      if (opener?.readerId !== readerId || !snapshot.readers.some(reader => reader.id === readerId)) return false
      return opener.focus()
    },
    close,
    pick: tool => {
      if (snapshot.openReader !== tool.readerId || !snapshot.tools.includes(tool)) return
      publish({ ...snapshot, openReader: null, closeReason: 'pick' })
      tool.open()
    },
  }
}
