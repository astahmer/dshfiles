/** Limits shared by the Host and the Settings form; this module stays free of Node imports so the Client can load it. */
export const EXPIRY_PRESETS = ['1h', '1d', '7d', 'never'] as const
export type ExpiryPreset = (typeof EXPIRY_PRESETS)[number]

export const PASSPHRASE_MIN = 8
export const PASSPHRASE_MAX = 256
