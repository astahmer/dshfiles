import { Byte, Encoder } from '@nuintun/qrcode'

/** Half-block rows so a terminal shows a square code; `small` doubles modules per cell. */
export const renderTerminalQr = (value: string, options: { readonly quietZone?: number } = {}): string => {
  const encoded = new Encoder({ level: 'M' }).encode(new Byte(value))
  const quiet = options.quietZone ?? 2
  const size = encoded.size
  const lines: string[] = []
  for (let y = -quiet; y < size + quiet; y += 2) {
    let line = '  '
    for (let x = -quiet; x < size + quiet; x += 1) {
      const top = y >= 0 && y < size && x >= 0 && x < size && encoded.get(x, y) === 1
      const bottomY = y + 1
      const bottom = bottomY >= 0 && bottomY < size && x >= 0 && x < size && encoded.get(x, bottomY) === 1
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
    }
    lines.push(line)
  }
  return lines.join('\n')
}
