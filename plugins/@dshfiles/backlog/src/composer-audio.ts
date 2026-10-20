export interface VoiceCapture {
  readonly startedAt: number
  stop(): Promise<Uint8Array>
  cancel(): Promise<void>
}

const SAMPLE_RATE = 16_000
const PROCESSOR_FRAMES = 4_096

const mergeSamples = (chunks: readonly Float32Array[]): Float32Array<ArrayBuffer> => {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const merged = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

const resample = async (samples: Float32Array<ArrayBuffer>, from: number, to: number): Promise<Float32Array<ArrayBuffer>> => {
  if (from === to || samples.length === 0) return samples
  const length = Math.max(1, Math.ceil((samples.length * to) / from))
  const offline = new OfflineAudioContext(1, length, to)
  const buffer = offline.createBuffer(1, samples.length, from)
  buffer.copyToChannel(samples, 0)
  const source = offline.createBufferSource()
  source.buffer = buffer
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

const encodeWave = (samples: Float32Array): Uint8Array => {
  const bytes = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(bytes)
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return new Uint8Array(bytes)
}

/** Captures mono microphone samples through Web Audio, resampled to the canonical 16 kHz PCM16 WAV. */
export const startVoiceCapture = async (): Promise<VoiceCapture> => {
  if (navigator.mediaDevices === undefined || window.AudioContext === undefined) {
    throw new Error('This browser cannot record audio.')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const context = new AudioContext()
  await context.resume()
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(PROCESSOR_FRAMES, 1, 1)
  const chunks: Float32Array[] = []
  processor.onaudioprocess = event => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(processor)
  processor.connect(mute)
  mute.connect(context.destination)
  let finished = false
  const release = async (): Promise<void> => {
    processor.onaudioprocess = null
    source.disconnect()
    processor.disconnect()
    mute.disconnect()
    for (const track of stream.getTracks()) track.stop()
  }
  const stop = async (): Promise<Uint8Array> => {
    if (finished) throw new Error('The recording already stopped.')
    finished = true
    const sampleRate = context.sampleRate
    await release()
    const merged = mergeSamples(chunks)
    await context.close()
    return encodeWave(await resample(merged, sampleRate, SAMPLE_RATE))
  }
  const cancel = async (): Promise<void> => {
    if (finished) return
    finished = true
    await release()
    await context.close().catch(() => undefined)
  }
  return { startedAt: Date.now(), stop, cancel }
}

export const audioBase64 = (bytes: Uint8Array): string => {
  const chunk = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)))
  }
  return btoa(binary)
}
