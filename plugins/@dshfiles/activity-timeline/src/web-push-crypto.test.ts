import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { WebPushCrypto } from './web-push-crypto.js'

/** The browser's side of RFC 8291: decrypt one `aes128gcm` body with the subscription's private key and auth secret. */
const decrypt = (body: Buffer, receiver: ReturnType<typeof createECDH>, auth: Buffer): Buffer => {
  const salt = body.subarray(0, 16)
  const idlen = body.readUInt8(20)
  const senderPublic = body.subarray(21, 21 + idlen)
  const sealed = body.subarray(21 + idlen)
  const receiverPublic = receiver.getPublicKey()
  const shared = receiver.computeSecret(senderPublic)
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublic, senderPublic]), 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(sealed.subarray(sealed.length - 16))
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()])
  expect(plain.at(-1)).toBe(2)
  return plain.subarray(0, plain.length - 1)
}

describe('WebPushCrypto', () => {
  it('encrypts a payload the subscription can decrypt (RFC 8291 aes128gcm)', () => {
    const receiver = createECDH('prime256v1')
    receiver.generateKeys()
    const auth = randomBytes(16)
    const payload = Buffer.from(JSON.stringify({ title: 'Fix auth callback', body: 'Asks: Deploy now?' }))
    const body = WebPushCrypto.encrypt({ p256dh: receiver.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }, payload)
    expect(body.readUInt32BE(16)).toBe(4096)
    expect(body.readUInt8(20)).toBe(65)
    expect(decrypt(body, receiver, auth).toString()).toBe(payload.toString())
  })

  it('signs a VAPID JWT for the push service origin that verifies with the public key', () => {
    const keys = WebPushCrypto.generateVapidKeys()
    expect(Buffer.from(keys.publicKey, 'base64url')).toHaveLength(65)
    const header = WebPushCrypto.vapidAuthorization({
      endpoint: 'https://web.push.apple.com/QGx/abc',
      keys,
      subject: 'mailto:dsh@localhost',
      nowSeconds: 1_000,
    })
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/u) ?? []
    expect(k).toBe(keys.publicKey)
    const [h, c, s] = (token ?? '').split('.')
    expect(JSON.parse(Buffer.from(c ?? '', 'base64url').toString())).toEqual({
      aud: 'https://web.push.apple.com',
      exp: 1_000 + 43_200,
      sub: 'mailto:dsh@localhost',
    })
    const point = Buffer.from(keys.publicKey, 'base64url')
    const publicKey = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') },
      format: 'jwk',
    })
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s ?? '', 'base64url'))).toBe(true)
  })
})
