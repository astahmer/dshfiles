/**
 * Writes the static theme block `@dshfiles/ui-styles` injects (visual refresh T0.2):
 *
 *   node plugins/@dshfiles/plugin-ui/scripts/emit-theme-css.ts          # write
 *   node plugins/@dshfiles/plugin-ui/scripts/emit-theme-css.ts --check  # exit 1 when the file drifted
 *
 * P0 ships a static block; runtime generation from settings is P6.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { themeCss } from '../src/theme/theme-css.ts'

const target = fileURLToPath(new URL('../../ui-styles/src/theme.generated.css', import.meta.url))
const css = themeCss()

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8')
  if (current !== css) {
    console.error(`${target} is stale: run node plugins/@dshfiles/plugin-ui/scripts/emit-theme-css.ts`)
    process.exit(1)
  }
  console.log(`${target} is up to date`)
} else {
  writeFileSync(target, css)
  console.log(`wrote ${target} (${css.length} bytes)`)
}
