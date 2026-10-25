import { storedNotificationSoundsMuted, type ThreadNotificationSound } from './thread-notifications.js'

interface NotificationTone {
  readonly frequency: number
  readonly waveform: OscillatorType
  /** Seconds from start until the tone is silent. */
  readonly duration: number
  /** Gain of the fundamental at full volume, before the user's volume is applied. */
  readonly peak: number
  /** Second partial at twice the frequency, for the bells; 0 leaves a pure tone. */
  readonly overtone: number
}

const notificationTones = {
  soft: { frequency: 440, waveform: 'sine', duration: 0.34, peak: 0.32, overtone: 0 },
  chime: { frequency: 660, waveform: 'sine', duration: 0.42, peak: 0.3, overtone: 0.45 },
  bright: { frequency: 880, waveform: 'triangle', duration: 0.3, peak: 0.26, overtone: 0.3 },
  low: { frequency: 330, waveform: 'sine', duration: 0.46, peak: 0.34, overtone: 0 },
} satisfies Record<ThreadNotificationSound, NotificationTone>

let audioContext: AudioContext | null = null

const createAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  try {
    const context = new window.AudioContext()
    audioContext = context
    return context
  } catch {
    return null
  }
}

const audioContextOrCreate = (): AudioContext | null => audioContext ?? createAudioContext()

/**
 * A running context, or null when this browser cannot give us one. Alerts arrive in a
 * background tab where no gesture can resume it, so the context is created on the first
 * user gesture and resumed again here before every tone.
 */
const runningAudioContext = async (): Promise<AudioContext | null> => {
  const context = audioContextOrCreate()
  if (context === null) return null
  if (context.state === 'suspended') {
    try {
      await context.resume()
    } catch {
      return null
    }
  }
  return context.state === 'running' ? context : null
}

const scheduleTone = (context: AudioContext, sound: ThreadNotificationSound, volume: number): void => {
  if (volume <= 0) return
  const tone = notificationTones[sound]
  const startsAt = context.currentTime
  const gain = context.createGain()
  gain.gain.setValueAtTime(0, startsAt)
  gain.gain.linearRampToValueAtTime(volume * tone.peak, startsAt + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + tone.duration)
  gain.connect(context.destination)
  for (const partial of tone.overtone > 0 ? [1, 2] : [1]) {
    const oscillator = context.createOscillator()
    oscillator.type = partial === 1 ? tone.waveform : 'sine'
    oscillator.frequency.setValueAtTime(tone.frequency * partial, startsAt)
    if (partial === 1) {
      oscillator.connect(gain)
    } else {
      const partialGain = context.createGain()
      partialGain.gain.setValueAtTime(tone.overtone, startsAt)
      oscillator.connect(partialGain)
      partialGain.connect(gain)
    }
    oscillator.start(startsAt)
    oscillator.stop(startsAt + tone.duration)
  }
}

/** Play a sound outside a gesture: resume first, then schedule, so a suspended context still rings. */
const playThreadNotificationSound = (sound: ThreadNotificationSound, volume: number): void => {
  if (storedNotificationSoundsMuted.get() === true) return
  void runningAudioContext().then(context => {
    if (storedNotificationSoundsMuted.get() === true) return
    if (context === null) return
    try {
      scheduleTone(context, sound, volume)
    } catch {
      return
    }
  })
}

const previewThreadNotificationSound = async (sound: ThreadNotificationSound, volume: number): Promise<boolean> => {
  const context = await runningAudioContext()
  if (context === null) return false
  try {
    scheduleTone(context, sound, volume)
  } catch {
    return false
  }
  return true
}

export class ThreadNotificationAudioModel {
  static readonly unlock = async (): Promise<boolean> => (await runningAudioContext()) !== null
  static readonly play = playThreadNotificationSound
  static readonly preview = previewThreadNotificationSound
}
