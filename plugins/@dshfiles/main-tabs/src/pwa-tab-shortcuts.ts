export const handlePwaTabShortcut = (options: {
  readonly event: KeyboardEvent
  readonly standalone: boolean
  readonly mac: boolean
  readonly run: (action: 'new' | 'reopen' | 'close') => boolean
}): void => {
  const { event } = options
  const primary = options.mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!options.standalone || !primary || event.altKey || event.repeat || event.isComposing || event.defaultPrevented) return
  const action = event.code === 'KeyT' ? (event.shiftKey ? 'reopen' : 'new') : event.code === 'KeyW' && !event.shiftKey ? 'close' : undefined
  if (action === undefined || !options.run(action)) return
  event.preventDefault()
  event.stopPropagation()
}
