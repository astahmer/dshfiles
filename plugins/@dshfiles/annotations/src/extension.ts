import { createHash } from 'node:crypto'

/**
 * The extension id is derived from the public key committed in
 * `extension/manifest.json`, so it is the same on every machine and the Host can
 * trust one exact origin instead of asking each install to copy its own id.
 */
export const EXTENSION_ID = 'onffhgfpkepofnhfaklomllipdpgmmbb'

export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`

/** Chrome maps each hex digit of the first 16 SHA-256 bytes onto `a`..`p`. */
export const deriveExtensionId = (publicKeyBase64: string): string => {
  const digest = createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest('hex').slice(0, 32)
  return Array.from(digest, character => String.fromCharCode(97 + Number.parseInt(character, 16))).join('')
}

/**
 * The pinned origin by default. The env seam stays for a locally loaded copy of
 * another build; it is not part of the normal setup.
 */
export const extensionOrigins = ({ env }: { readonly env: NodeJS.ProcessEnv }): readonly string[] => {
  const configured = (env.DSH_ANNOTATIONS_EXTENSION_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0)
  return configured.length > 0 ? configured : [EXTENSION_ORIGIN]
}
