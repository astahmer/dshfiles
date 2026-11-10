import { Byte, Encoder } from '@nuintun/qrcode'

/** Indexed by top * 2 + bottom module. */
const HALF_BLOCKS = [' ', '▄', '▀', '█'] as const

/** Half-block rows so a terminal shows a square code. */
export const renderTerminalQr = (value: string, quietZone = 2): string => {
  const encoded = new Encoder({ level: 'M' }).encode(new Byte(value))
  const size = encoded.size
  const lines: string[] = []
  for (let y = -quietZone; y < size + quietZone; y += 2) {
    let line = '  '
    for (let x = -quietZone; x < size + quietZone; x += 1) {
      const top = y >= 0 && y < size && x >= 0 && x < size && encoded.get(x, y) === 1
      const bottom = y + 1 >= 0 && y + 1 < size && x >= 0 && x < size && encoded.get(x, y + 1) === 1
      line += HALF_BLOCKS[Number(top) * 2 + Number(bottom)]
    }
    lines.push(line)
  }
  return lines.join('\n')
}
