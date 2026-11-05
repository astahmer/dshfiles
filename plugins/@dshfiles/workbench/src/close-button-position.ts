export const CLOSE_BUTTON_POSITIONS = ['left', 'right'] as const
export type CloseButtonPosition = (typeof CLOSE_BUTTON_POSITIONS)[number]
export const DEFAULT_CLOSE_BUTTON_POSITION: CloseButtonPosition = 'right'
