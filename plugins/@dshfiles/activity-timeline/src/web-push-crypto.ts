/**
 * Web Push on the Host with Node's crypto only (productivity pass T6.5): VAPID keys and their ES256 JWT (RFC 8292),
 * and the `aes128gcm` payload encryption every push service accepts (RFC 8291 on RFC 8188). No push library and no
 * network here; the sender owns the request.
 */
import { createECDH, createPrivateKey, createCipheriv, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto'

export interface VapidKeys {
  /** The uncompressed P-256 public point (65 bytes), base64url: the browser's `applicationServerKey`. */
  readonly publicKey: string
  /** The private scalar `d` (32 bytes), base64url. */
  readonly privateKey: string
}

export interface PushSubscriptionKeys {
  readonly endpoint: string
  /** The browser's P-256 public key (65 bytes), base64url. */
  readonly p256dh: string
  /** The browser's 16-byte authentication secret, base64url. */
  readonly auth: string
}

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')
const fromB64url = (text: string): Buffer => Buffer.from(text, 'base64url')

const generateVapidKeys = (): VapidKeys => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const priv = privateKey.export({ format: 'jwk' })
  if (jwk.x === undefined || jwk.y === undefined || priv.d === undefined) throw new Error('P-256 key export lacks a coordinate')
  return { publicKey: b64url(Buffer.concat([Buffer.from([4]), fromB64url(jwk.x), fromB64url(jwk.y)])), privateKey: priv.d }
}

/**
 * The `Authorization` header for one push request: a JWT for the push service's origin, valid 12 hours, signed with
 * ES256 (raw r||s), and the public key the subscription was made with.
 */
const vapidAuthorization = (input: { readonly endpoint: string; readonly keys: VapidKeys; readonly subject: string; readonly nowSeconds: number }): string => {
  const point = fromB64url(input.keys.publicKey)
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33, 65)), d: input.keys.privateKey },
    format: 'jwk',
  })
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(Buffer.from(JSON.stringify({ aud: new URL(input.endpoint).origin, exp: input.nowSeconds + 12 * 60 * 60, sub: input.subject })))
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${input.keys.publicKey}`
}

const RECORD_SIZE = 4096

/**
 * One `aes128gcm` body for a subscription: salt(16) | rs(4) | idlen(1) | the sender's ephemeral public key (65), then
 * the payload sealed with AES-128-GCM under keys derived from ECDH with the browser key and its auth secret.
 */
const encrypt = (subscription: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>, payload: Uint8Array): Buffer => {
  const receiverPublic = fromB64url(subscription.p256dh)
  const authSecret = fromB64url(subscription.auth)
  const ephemeral = createECDH('prime256v1')
  const senderPublic = ephemeral.generateKeys()
  const shared = ephemeral.computeSecret(receiverPublic)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublic, senderPublic])
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  const salt = randomBytes(16)
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // One record: the payload, then the last-record delimiter 0x02 (no padding).
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])
  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(senderPublic.length, 20)
  return Buffer.concat([header, senderPublic, sealed])
}

export class WebPushCrypto {
  static readonly generateVapidKeys = generateVapidKeys
  static readonly vapidAuthorization = vapidAuthorization
  static readonly encrypt = encrypt
}
