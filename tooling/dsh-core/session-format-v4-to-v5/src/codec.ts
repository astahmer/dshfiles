import {
  isSessionFormatJsonObject,
  SessionFormatError,
} from '@deepseek-ai/dsh-session-format'
import type {
  SessionFormatCodec,
  SessionFormatCurrentEncoder,
  SessionFormatHeader,
} from '@deepseek-ai/dsh-session-format'
import { sessionRuntimeBindingSchema } from '@deepseek-ai/dsh-session'
import { releasedV4SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertReleasedV5Header, releasedV4Header } from './validation.ts'

const releasedV4PhysicalHeader = (value: unknown): Record<string, unknown> => {
  if (!isSessionFormatJsonObject(value)) throw new SessionFormatError('expected format v5 physical header')
  if (Object.hasOwn(value, 'runtimeBinding')
    && !sessionRuntimeBindingSchema.safeParse(value['runtimeBinding']).success) {
    throw new SessionFormatError('format v5 header runtimeBinding is invalid')
  }
  const physicalHeader: Record<string, unknown> = { ...value, version: 4 }
  delete physicalHeader.runtimeBinding
  return physicalHeader
}

const withV5Header = (header: SessionFormatHeader, value: unknown): SessionFormatHeader => {
  if (!isSessionFormatJsonObject(value) || !Object.hasOwn(value, 'runtimeBinding')) {
    return { ...header, version: 5 }
  }
  return {
    ...header,
    version: 5,
    runtimeBinding: sessionRuntimeBindingSchema.parse(value['runtimeBinding']),
  }
}

const decodeV5Header = (value: unknown): SessionFormatHeader => {
  const header = releasedV4SessionFormatCodec.decodeHeader(releasedV4PhysicalHeader(value))
  const restored = withV5Header(header, value)
  assertReleasedV5Header(restored)
  return restored
}

/** V5 retains V4 event framing and adds the immutable Host runtime selection. */
export const releasedV5SessionFormatCodec = Object.freeze({
  version: 5,
  decodeHeader(value: unknown) {
    return decodeV5Header(value)
  },
  createDecoder(value, recovery) {
    const header = decodeV5Header(value)
    const decoder = releasedV4SessionFormatCodec.createDecoder(releasedV4PhysicalHeader(value), recovery)
    return {
      ...decoder,
      header,
      decodeRow(row, context) {
        decoder.decodeRow(row, context)
      },
    }
  },
  encodeHeader(header, inheritedEventCount) {
    assertReleasedV5Header(header)
    const encoded = releasedV4SessionFormatCodec.encodeHeader(
      releasedV4Header(header),
      inheritedEventCount,
    )
    return {
      ...encoded,
      version: 5,
      ...(header['runtimeBinding'] === undefined ? {} : { runtimeBinding: header['runtimeBinding'] }),
    }
  },
  encodeEvent(event) {
    return releasedV4SessionFormatCodec.encodeEvent(event)
  },
} satisfies SessionFormatCodec & SessionFormatCurrentEncoder)
