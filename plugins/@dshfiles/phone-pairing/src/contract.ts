import { defineContract } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

/**
 * The pairing QR, rendered by the plugin that owns phone access where the sidebar footer shows its actions. The sidebar
 * renders nothing while phone-pairing is absent, so copying the launch URL keeps working without it.
 */
export const PhonePairingQr = defineContract<{ readonly Button: ComponentType }>('@dshfiles/phone-pairing.qr', {
  owner: '@dshfiles/phone-pairing',
})
