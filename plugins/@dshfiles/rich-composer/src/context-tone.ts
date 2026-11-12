/** The composer's context ring (composer redesign b:v9yh): when it shows and which tone it takes. */

/**
 * Composer redesign (b:v9yh): below this occupancy the ring stays out of the bar (an empty ring read as loading);
 * from it the ring shows without text, the exact reading in its tooltip. Amber from WARN, red from DANGER.
 */
export const CONTEXT_METER_VISIBLE_FROM = 25
const WARN = 80
const DANGER = 95

/** The ring's tone for an occupancy: neutral, warn (amber) or danger (red). */
export const contextTone = (percent: number): 'neutral' | 'warn' | 'danger' => (percent >= DANGER ? 'danger' : percent >= WARN ? 'warn' : 'neutral')
