import { randomBytes } from 'node:crypto'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const TIME_CHARS = 10
const RANDOM_CHARS = 16

const encodeTime = (time: number): string => {
  let rest = Math.max(0, Math.floor(time))
  let encoded = ''
  for (let index = 0; index < TIME_CHARS; index += 1) {
    encoded = `${CROCKFORD[rest % 32] ?? '0'}${encoded}`
    rest = Math.floor(rest / 32)
  }
  return encoded
}

const encodeRandom = (): string => [...randomBytes(RANDOM_CHARS)].map(byte => CROCKFORD[byte % 32] ?? '0').join('')

/** A ULID: 48-bit millisecond time then 80 random bits, Crockford base32, so ids sort by creation on any host. */
export const ulid = (time: number): string => `${encodeTime(time)}${encodeRandom()}`

export const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/
