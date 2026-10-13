import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { listSshConfigHosts } from '../src/ssh-config.js'

describe('SSH host suggestions', () => {
  test('lists concrete aliases through Include and plain known hosts, skipping wildcards and hashed entries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'multi-host-ssh-'))
    try {
      await mkdir(join(directory, 'conf.d'))
      await writeFile(join(directory, 'config'), 'Include conf.d/*\nHost *\n  User me\nHost m1-perso work-?\n')
      await writeFile(join(directory, 'conf.d', 'pi'), 'Host raspberrypi\n  User pi\n')
      await writeFile(join(directory, 'known_hosts'), 'raspberrypi,192.168.1.2 ssh-ed25519 AAAA\n|1|hash= ssh-ed25519 AAAA\nvps.example ssh-ed25519 AAAA\n')
      expect(await listSshConfigHosts(directory)).toEqual({ aliases: ['m1-perso', 'raspberrypi'], knownHosts: ['192.168.1.2', 'vps.example'] })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
