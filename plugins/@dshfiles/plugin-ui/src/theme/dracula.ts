/**
 * The built-in Dracula theme, from the official specification (https://draculatheme.com/spec): Dracula Classic in dark,
 * Alucard Classic (its official light companion) in light, with a night sky (twinkling stars, a violet moon) behind the
 * conversation in dark. A plain theme definition, so it renders through the same path as any theme an agent defines.
 *
 * Every colour comes from the spec's palette, UI palette or ANSI palette, except where the spec has no role: the faint
 * and secondary text steps and the strong border, and red text on raised fills, which uses the spec's bright red.
 */
import type { Backdrop, IdentityTuple, ThemeDefinition } from './theme-definition.ts'

/** Dracula Classic: palette, UI palette and ANSI bright colours. */
export const DRACULA = {
  background: '#282a36',
  backgroundDark: '#21222c',
  backgroundLight: '#343746',
  backgroundLighter: '#424450',
  selection: '#44475a',
  foreground: '#f8f8f2',
  comment: '#6272a4',
  cyan: '#8be9fd',
  green: '#50fa7b',
  orange: '#ffb86c',
  pink: '#ff79c6',
  purple: '#bd93f9',
  red: '#ff5555',
  brightRed: '#ff6e6e',
  yellow: '#f1fa8c',
} as const

/** Alucard Classic: palette and UI palette. */
export const ALUCARD = {
  background: '#fffbeb',
  floating: '#efeddc',
  backgroundLighter: '#ece9df',
  backgroundLight: '#dedccf',
  backgroundDark: '#ceccc0',
  backgroundDarker: '#bcbab3',
  selection: '#cfcfde',
  foreground: '#1f1f1f',
  comment: '#6c664b',
  cyan: '#036a96',
  green: '#14710a',
  orange: '#a34d14',
  pink: '#a3144d',
  purple: '#644ac9',
  red: '#cb3a2a',
  yellow: '#846e15',
} as const

/**
 * The identity palette (round eight): the spec's six accent colours, in the order the owner chose, so each slot sits
 * near the default theme's (azure → cyan, olive → green, copper → orange, violet → purple, magenta → pink). Alucard's
 * yellow is darkened at its own hue (#846e15 → #7d6706) because the spec's yellow reads at only 4.09:1 on the raised
 * fill; every other colour is the spec's own.
 */
const PALETTE_NAMES: IdentityTuple = ['Cyan', 'Green', 'Orange', 'Purple', 'Pink', 'Yellow']
export const ALUCARD_TEXT_YELLOW = '#7d6706'
const DRACULA_PALETTE: IdentityTuple = [DRACULA.cyan, DRACULA.green, DRACULA.orange, DRACULA.purple, DRACULA.pink, DRACULA.yellow]
const ALUCARD_PALETTE: IdentityTuple = [ALUCARD.cyan, ALUCARD.green, ALUCARD.orange, ALUCARD.purple, ALUCARD.pink, ALUCARD_TEXT_YELLOW]

/** A star: x and y inside its tile (px), radius (px), alpha. */
type Star = readonly [x: number, y: number, r: number, a: number]
type StarTile = readonly [tile: number, stars: readonly Star[]]

/** Prime tile sizes keep the repeats from lining up into a grid; positions are fixed, so every reload looks the same. */
const STATIC_STARS: readonly StarTile[] = [
  [
    173,
    [
      [23, 41, 0.8, 0.55],
      [131, 117, 0.7, 0.45],
      [88, 152, 0.6, 0.4],
    ],
  ],
  [
    251,
    [
      [61, 199, 0.9, 0.6],
      [202, 37, 0.7, 0.5],
    ],
  ],
  [
    337,
    [
      [289, 263, 1, 0.7],
      [117, 83, 0.8, 0.5],
    ],
  ],
]
const TWINKLE_A: readonly StarTile[] = [
  [
    199,
    [
      [47, 67, 1.1, 0.95],
      [163, 151, 0.9, 0.8],
    ],
  ],
  [
    313,
    [
      [241, 29, 1.3, 1],
      [97, 233, 1, 0.85],
    ],
  ],
]
const TWINKLE_B: readonly StarTile[] = [
  [
    227,
    [
      [181, 97, 1.1, 0.9],
      [29, 191, 0.9, 0.8],
    ],
  ],
  [
    379,
    [
      [331, 307, 1.4, 1],
      [149, 41, 1, 0.85],
    ],
  ],
]

/** Star glow: the foreground with hints of Dracula's cyan and pink. */
const STAR_TINTS = ['248 248 242', '214 240 255', '255 226 244'] as const

/** Background images of a star layer and their tile sizes, index for index. */
interface StarLayers {
  readonly images: string[]
  readonly sizes: string[]
}

function stars(tiles: readonly StarTile[]): StarLayers {
  const images: string[] = []
  const sizes: string[] = []
  tiles.forEach(([tile, list], layer) => {
    list.forEach(([x, y, r, a], index) => {
      const tint = STAR_TINTS[(layer + index) % STAR_TINTS.length] ?? STAR_TINTS[0]
      images.push(`radial-gradient(circle at ${x}px ${y}px, rgb(${tint} / ${a}) 0, rgb(${tint} / ${a}) ${r}px, rgb(${tint} / 0) ${(r * 2.4).toFixed(1)}px)`)
      sizes.push(`${tile}px ${tile}px`)
    })
  })
  return { images, sizes }
}

/** The violet moon in the top-right corner, below the thread header: highlight, three craters, the disc, its halo. */
const MOON = [
  'radial-gradient(circle at calc(100% - 136px) 178px, rgb(255 255 255 / 0.35) 0, rgb(255 255 255 / 0) 9px)',
  'radial-gradient(circle at calc(100% - 158px) 198px, rgb(98 74 158 / 0.45) 0, rgb(98 74 158 / 0.45) 6px, rgb(98 74 158 / 0) 8px)',
  'radial-gradient(circle at calc(100% - 132px) 206px, rgb(98 74 158 / 0.35) 0, rgb(98 74 158 / 0.35) 4px, rgb(98 74 158 / 0) 6px)',
  'radial-gradient(circle at calc(100% - 168px) 172px, rgb(98 74 158 / 0.3) 0, rgb(98 74 158 / 0.3) 3px, rgb(98 74 158 / 0) 5px)',
  `radial-gradient(circle at calc(100% - 150px) 190px, #e4d2ff 0, #c9a6ff 24px, ${DRACULA.purple} 38px, rgb(189 147 249 / 0) 39.5px)`,
  'radial-gradient(circle at calc(100% - 150px) 190px, rgb(189 147 249 / 0.28) 36px, rgb(189 147 249 / 0.1) 70px, rgb(189 147 249 / 0) 150px)',
]

function layer(images: readonly string[], sizes: readonly string[], repeats: readonly string[], extra: readonly string[] = []): string {
  return [`background-image: ${images.join(', ')}`, `background-size: ${sizes.join(', ')}`, `background-repeat: ${repeats.join(', ')}`, ...extra].join('; ')
}

function nightSky(): Backdrop {
  const base = stars(STATIC_STARS)
  const a = stars(TWINKLE_A)
  const b = stars(TWINKLE_B)
  const sky = `linear-gradient(180deg, ${DRACULA.backgroundDark} 0%, ${DRACULA.background} 70%)`
  return {
    layers: [
      layer(
        [...MOON, ...base.images, sky],
        [...MOON.map(() => 'auto'), ...base.sizes, 'auto'],
        [...MOON.map(() => 'no-repeat'), ...base.sizes.map(() => 'repeat'), 'no-repeat'],
      ),
      // Only opacity animates: the layers composite on the GPU and nothing repaints per frame.
      layer(
        b.images,
        b.sizes,
        b.sizes.map(() => 'repeat'),
        ['animation: dshx-dracula-twinkle 5.3s ease-in-out -2.1s infinite alternate'],
      ),
      layer(
        a.images,
        a.sizes,
        a.sizes.map(() => 'repeat'),
        ['animation: dshx-dracula-twinkle 3.7s ease-in-out infinite alternate'],
      ),
    ],
    keyframes: '@keyframes dshx-dracula-twinkle { from { opacity: 0.15; } to { opacity: 1; } }',
  }
}

export const DRACULA_THEME: ThemeDefinition = {
  id: 'dracula',
  label: 'Dracula',
  description: 'Official Dracula Classic in dark, with a night sky behind the conversation, and Alucard Classic in light.',
  dark: {
    colours: {
      bg: DRACULA.background,
      panel: DRACULA.backgroundDark,
      raised: DRACULA.backgroundLight,
      selected: DRACULA.selection,
      line: DRACULA.backgroundLighter,
      border: DRACULA.selection,
      borderStrong: '#565a73',
      strong: DRACULA.comment,
      faint: '#7f8bbd',
      muted: '#c0c2d4',
      text: DRACULA.foreground,
      accent: DRACULA.purple,
      onAccent: DRACULA.background,
      success: DRACULA.green,
      warning: DRACULA.orange,
      danger: '#ff7b7b',
      info: DRACULA.cyan,
    },
    // Token classification from the spec: keywords pink, functions green, strings yellow, numbers and constants orange,
    // variables and parameters foreground.
    syntax: {
      comment: DRACULA.comment,
      punctuation: DRACULA.foreground,
      constant: DRACULA.orange,
      keyword: DRACULA.pink,
      parameter: DRACULA.foreground,
      function: DRACULA.green,
      string: DRACULA.yellow,
    },
    backdrop: nightSky(),
    palette: DRACULA_PALETTE,
    paletteNames: PALETTE_NAMES,
  },
  light: {
    colours: {
      bg: ALUCARD.background,
      panel: ALUCARD.floating,
      raised: ALUCARD.backgroundLighter,
      selected: ALUCARD.selection,
      line: ALUCARD.backgroundLight,
      border: ALUCARD.backgroundDark,
      borderStrong: ALUCARD.backgroundDarker,
      strong: '#9a957e',
      faint: ALUCARD.comment,
      muted: '#4a473d',
      text: ALUCARD.foreground,
      accent: ALUCARD.purple,
      onAccent: ALUCARD.background,
      success: ALUCARD.green,
      warning: ALUCARD.orange,
      danger: ALUCARD.red,
      info: ALUCARD.cyan,
    },
    syntax: {
      comment: ALUCARD.comment,
      punctuation: ALUCARD.foreground,
      constant: ALUCARD.orange,
      keyword: ALUCARD.pink,
      parameter: ALUCARD.foreground,
      function: ALUCARD.green,
      string: ALUCARD.yellow,
    },
    palette: ALUCARD_PALETTE,
    paletteNames: PALETTE_NAMES,
  },
}
