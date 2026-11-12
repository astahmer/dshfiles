export const handlePwaCloseShortcut = (options: {
  readonly event: KeyboardEvent
  readonly standalone: boolean
  readonly mac: boolean
  readonly close: () => boolean
}): void => {
  const { event } = options
  const primary = options.mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!options.standalone || !primary || event.code !== 'KeyW' || event.altKey || event.shiftKey || event.repeat || event.isComposing || event.defaultPrevented) return
  if (!options.close()) return
  event.preventDefault()
  event.stopPropagation()
}
