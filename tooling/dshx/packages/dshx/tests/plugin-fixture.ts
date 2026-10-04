import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const PLUGIN_FIXTURE_FILES: Readonly<Record<string, string>> = {
  'cordis.patch.yml': `- insert:
    - id: dshx-fixture
      name: "@dshx/fixture-plugin"
`,
  'package.json': `{
  "name": "@dshx/fixture-plugin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js",
    "./client": "./dist/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": [
    "dist",
    "cordis.patch.yml"
  ],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-ui-sidebar"
      ],
      "external": [],
      "immediately": false
    }
  },
  "devDependencies": {
    "@types/react": "~18.3.31",
    "@deepseek-ai/dsh": "0.2.0-rc.2",
    "@deepseek-ai/dsh-cordis-host-runner": "0.2.0-rc.2",
    "@deepseek-ai/dsh-client-ui-sidebar": "0.2.0-rc.2",
    "@deepseek-ai/dsh-client-ui-slots": "0.2.0-rc.2",
    "@deepseek-ai/dsh-tools": "0.2.0-rc.2",
    "@deepseek-ai/dsh-tool-cordis": "0.2.0-rc.2",
    "@dshfiles/dshx": "workspace:*",
    "react": "^18.3.1"
  },
  "peerDependencies": {
    "@deepseek-ai/dsh": ">=0.2.0-rc.1 <0.3.0-0",
    "@deepseek-ai/dsh-tools": ">=0.2.0-rc.1 <0.3.0-0"
  }
}
`,
  'src/Status.module.css': `.deck {
  width: min(252px, calc(100vw - 28px));
  overflow: hidden;
  color: #eff7f5;
  background: #101b2a;
  border: 1px solid #2a4050;
  border-radius: 14px;
  box-shadow: 0 16px 34px rgba(7, 17, 28, 0.2);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.summary {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 10px 12px;
  cursor: pointer;
  list-style: none;
}

.summary::-webkit-details-marker {
  display: none;
}

.summary:focus-visible {
  outline: 2px solid #6de0c5;
  outline-offset: -3px;
}

.brandMark {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border: 1px solid #2b6870;
  border-radius: 9px;
  background: #12343a;
}

.brandMark span {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #6de0c5;
  box-shadow: 0 0 0 4px rgba(109, 224, 197, 0.12);
}

.summaryCopy {
  display: grid;
  min-width: 0;
  gap: 2px;
  flex: 1;
}

.summaryCopy strong {
  overflow: hidden;
  color: #f4fbf9;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summaryCopy small {
  color: #93a9b8;
  font-size: 10px;
  letter-spacing: 0;
}

.live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #6de0c5;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.live span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #6de0c5;
}

.body {
  padding: 0 12px 12px;
}

.intro {
  padding: 13px 0 12px;
  border-top: 1px solid #223548;
}

.intro h2 {
  margin: 0;
  color: #f4fbf9;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

.intro p {
  max-width: 29ch;
  margin: 6px 0 0;
  color: #9db0be;
  font-size: 11px;
  line-height: 1.45;
}

.metrics {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid #223548;
  border-bottom: 1px solid #223548;
}

.metrics div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.metrics span {
  color: #8095a5;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.metrics strong {
  overflow: hidden;
  color: #e4f0ed;
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 13px 0 12px;
  list-style: none;
}

.activity li {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  color: #c5d4d6;
  font-size: 10px;
}

.activityMark {
  width: 6px;
  height: 6px;
  border: 1px solid #6de0c5;
  border-radius: 50%;
  background: #163e40;
}

.activity time {
  color: #718895;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.footer {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #87a0aa;
  font-size: 10px;
}

.footerPulse {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: #efc46d;
  transform: rotate(45deg);
}

@media (max-width: 420px) {
  .deck {
    width: min(252px, calc(100vw - 20px));
  }
}
`,
  'src/api/status.ts': `import { defineApi, method } from '@dshfiles/dshx/api'

export interface Status {
  readonly project: string
  readonly startedAt: string
  readonly requestCount: number
}

export const statusApi = defineApi({
  id: 'status',
  version: 1,
  methods: {
    get: method<void, Status>(),
    refresh: method<{ readonly force?: boolean }, Status>(),
  },
})
`,
  'src/client.tsx': `import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { defineClient, defineSlot, useApi, useApiQuery } from '@dshfiles/dshx/client'
import { statusApi } from './api/status.js'
import styles from './Status.module.css'

/** A compact runtime deck that makes the live Host/Client composition visible. */
export function StatusButton(_props: PropsRuntime<'sidebar.footer.action'>) {
  const api = useApi(statusApi)
  const status = useApiQuery(statusApi, 'get')
  const refresh = () => { void api.refresh({ force: true }).finally(() => status.refetch()) }
  return (
    <details className={styles.deck} open>
      <summary className={styles.summary} onClick={(event) => event.stopPropagation()}>
        <span className={styles.brandMark} aria-hidden="true"><span /></span>
        <span className={styles.summaryCopy}>
          <strong>DSHX Runtime</strong>
          <small>Live composition</small>
        </span>
        <span className={styles.live}><span aria-hidden="true" />LIVE</span>
      </summary>

      <div className={styles.body}>
        <div className={styles.intro}>
          <h2>Build. Ship. Observe.</h2>
          <p>Your plugin is running in the active web profile.</p>
        </div>

        <div className={styles.metrics}>
          <div><span>Profile</span><strong>web</strong></div>
          <div><span>Requests</span><strong>{status.data?.requestCount ?? '...'}</strong></div>
        </div>

        <ol className={styles.activity} aria-label="Runtime activity">
          <li><span className={styles.activityMark} /><span>{status.status === 'pending' ? 'Connecting to Host' : status.status === 'error' ? 'Host unavailable' : 'Host API connected'}</span><time>{status.status === 'error' ? 'retry' : 'live'}</time></li>
          <li><span className={styles.activityMark} /><span>Slot registered</span><time>now</time></li>
          <li><span className={styles.activityMark} /><span>{status.data?.project ?? 'Client syncing'}</span><time>{status.data?.startedAt.slice(11, 19) ?? '...'}</time></li>
        </ol>

        <div className={styles.footer}>
          <span className={styles.footerPulse} aria-hidden="true" />
          {status.status === 'error' ? <button type="button" onClick={status.refetch}>Retry connection</button> : <button type="button" onClick={refresh}>Refresh Host state</button>}
        </div>
      </div>
    </details>
  )
}

/** Register the Fixture component in an additive web-profile slot. */
const status = defineSlot('sidebar.footer.action', {
  id: 'dshx.fixture.status',
  order: 0,
  component: StatusButton,
})

export default defineClient({
  slots: [status],
})
`,
  'src/css-modules.d.ts': `declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
`,
  'src/host.ts': `import { defineHost, defineTool } from '@dshfiles/dshx/host'
import { statusApi } from './api/status.js'

const startedAt = new Date().toISOString()
let requestCount = 0

const fixtureTool = defineTool({
  name: 'dshx_fixture_status',
  description: 'Return the Fixture fixture status.',
  parameters: {},
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute() {
    return 'DSHX Fixture tool ready'
  },
})

const statusHostApi = statusApi.host({
  async get() {
    return { project: '@dshx/fixture-plugin', startedAt, requestCount: ++requestCount }
  },
  async refresh({ input }) {
    return { project: input.force ? '@dshx/fixture-plugin (refreshed)' : '@dshx/fixture-plugin', startedAt, requestCount: ++requestCount }
  },
})

export default defineHost({
  tools: [fixtureTool],
  apis: [statusHostApi],
  setup() {
    console.info('DSHX Fixture Host adapter loaded')
  },
})
`,
  'tsconfig.json': `{
  "compilerOptions": {
    "declaration": false,
    "noEmit": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "preserveSymlinks": true,
    "jsx": "react-jsx",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "target": "ES2024"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
`,
}

/** Write the protocol-2 plugin fixture (Host, Client, API, CSS module) into an empty project directory. */
export const writePluginFixture = async (directory: string): Promise<void> => {
  for (const [relativePath, content] of Object.entries(PLUGIN_FIXTURE_FILES)) {
    const target = resolve(directory, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}
