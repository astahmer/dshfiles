import { existsSync, readFileSync, realpathSync, readdirSync, statSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'

export const JjFilesystem = {
  existsSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
}
