import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { superviseDsh } from './supervise-dsh.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const controller = pathToFileURL(join(root, 'plugins/@dshfiles/thread-sidebar/src/restart.ts')).href

async function fixture(t, mode) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-supervisor-test-'))
  t.after(async () => {
    assert.equal(dirname(resolve(home)), resolve(tmpdir()))
    assert.ok(home.startsWith(join(resolve(tmpdir()), 'dsh-supervisor-test-')))
    await rm(home, { recursive: true, force: true })
  })
  const program = join(home, 'core.mjs')
  await writeFile(
    program,
    `
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRestartController} from ${JSON.stringify(controller)};
const home=process.env.DSH_HOME;
const path=join(home,'runs.json');
const previous=JSON.parse(await readFile(path,'utf8').catch(()=>'[]'));
previous.push({runId:process.env.DSH_RESTART_RUN_ID,requestPath:process.env.DSH_RESTART_REQUEST_PATH});
await writeFile(path,JSON.stringify(previous));
const mode=${JSON.stringify(mode)};
if(previous.length===1){
 if(mode==='native-request'){
  const controller=createRestartController({appExit:code=>process.exit(code)},{scheduleExit:exit=>void exit(),recordRunningSessions:async()=>{await writeFile(join(home,'flushed'),'yes')}});
  if(!controller.available) throw new Error('Native controller unavailable under supervisor');
  await controller.request();
 } else if(mode==='wrong-marker'){
  await writeFile(process.env.DSH_RESTART_REQUEST_PATH,'wrong-run-id');process.exit(75);
 } else if(mode==='no-marker'){process.exit(75)}
 else if(mode==='crash'){process.exit(9)}
 else if(mode==='url'){
  const {watchFile,unwatchFile}=await import('node:fs');
  const {stat}=await import('node:fs/promises');
  const recorded=new Promise((resolveRecorded,rejectRecorded)=>{
   const watched=join(home,'runtime/web-url');
   const timer=setTimeout(()=>{unwatchFile(watched);rejectRecorded(new Error('Launch URL not recorded'))},3000);
   // No kernel inotify watch is needed for this short-lived fixture.
   watchFile(watched,{interval:20},async()=>{
    const url=await readFile(join(home,'runtime/web-url'),'utf8').catch(()=>'');
    if(!url.includes('synthetic-fixture-only'))return;
    const info=await stat(join(home,'runtime/web-url'));
    if((info.mode&0o777)!==0o600)throw new Error('Launch URL file is not private');
    await writeFile(join(home,'url-checked'),'yes');
    clearTimeout(timer);unwatchFile(watched);resolveRecorded();
   });
  });
  process.stdout.write('dsh manuel: http://127.0.0.1:12345/?tok');
  process.stdout.write('en=synthetic-fixture-only\\n');
  await recorded;
 } else if(mode==='wait'){
  process.stdout.write('fixture-ready\\n');
  setInterval(()=>{},10000);
 }
}
`,
  )
  let output = ''
  const options = {
    home,
    command: process.execPath,
    args: ['--experimental-strip-types', program],
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home },
    stdout: {
      write: chunk => {
        output += String(chunk)
        return true
      },
    },
  }
  return { home, options, runs: async () => JSON.parse(await readFile(join(home, 'runs.json'), 'utf8')), output: () => output }
}

test('native restart controller is available and its confirmed request restarts exactly once', async t => {
  const f = await fixture(t, 'native-request')
  const preparation = [{ command: process.execPath, args: ['-e', 'require("node:fs").appendFileSync("prepared", "x")'] }]
  assert.equal(await superviseDsh({ ...f.options, stdout: process.stdout, preparation }), 0)
  assert.equal(await readFile(join(f.home, 'prepared'), 'utf8'), 'xx')
  const runs = await f.runs()
  assert.equal(runs.length, 2)
  assert.notEqual(runs[0].runId, runs[1].runId)
  assert.equal(await readFile(join(f.home, 'flushed'), 'utf8'), 'yes')
  for (const run of runs) assert.equal(run.requestPath, join(f.home, 'runtime', `dsh-web-restart-${run.runId}.request`))
  assert.deepEqual(await readdir(join(f.home, 'runtime')), [])
})

for (const mode of ['wrong-marker', 'no-marker', 'crash']) {
  test(`${mode} never triggers an automatic restart`, async t => {
    const f = await fixture(t, mode)
    assert.equal(await superviseDsh(f.options), mode === 'crash' ? 9 : 75)
    assert.equal((await f.runs()).length, 1)
  })
}

test('startup preparation failure never launches a Host', async t => {
  const f = await fixture(t, 'native-request')
  assert.equal(await superviseDsh({ ...f.options, stdout: process.stdout, preparation: [{ command: process.execPath, args: ['-e', 'process.exit(7)'] }] }), 7)
  await assert.rejects(f.runs(), /ENOENT/)
})

test('termination stops only its child and suppresses restart', async t => {
  const f = await fixture(t, 'wait')
  let requested = false
  const stdout = {
    write: chunk => {
      if (!requested && String(chunk).includes('fixture-ready')) {
        requested = true
        process.emit('SIGTERM')
      }
      return true
    },
  }
  assert.equal(await superviseDsh({ ...f.options, stdout }), 143)
  assert.equal((await f.runs()).length, 1)
})

test('split launch URL is privately recorded during the run and removed at exit', async t => {
  const f = await fixture(t, 'url')
  assert.equal(await superviseDsh(f.options), 0)
  assert.match(f.output(), /synthetic-fixture-only/)
  assert.equal(await readFile(join(f.home, 'url-checked'), 'utf8'), 'yes')
  await assert.rejects(readFile(join(f.home, 'runtime/web-url')), /ENOENT/)
})
