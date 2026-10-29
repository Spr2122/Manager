import { cpSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ExecResult, Remote } from '../src/main/remote'

// Реальная папка сайта рядом с проектом, если есть; иначе встроенная фикстура.
const REAL_SITE = resolve(__dirname, '../../site')
export const SITE_SRC = existsSync(join(REAL_SITE, 'src/data/products.json')) ? REAL_SITE : resolve(__dirname, 'fixture-site')

/** Минимальная копия сайта (без node_modules) во временной папке. */
export function tempSite(withDist = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'sopt-site-'))
  for (const f of ['package.json', 'astro.config.mjs', 'src/data/products.json', 'src/data/settings.json']) {
    mkdirSync(dirname(join(dir, f)), { recursive: true })
    cpSync(join(SITE_SRC, f), join(dir, f))
  }
  cpSync(join(SITE_SRC, 'public'), join(dir, 'public'), { recursive: true })
  if (withDist) cpSync(join(SITE_SRC, 'dist'), join(dir, 'dist'), { recursive: true })
  return dir
}
export const hasDist = existsSync(join(SITE_SRC, 'dist', 'index.html'))
export const rm = (d: string) => rmSync(d, { recursive: true, force: true })

/** «Сервер» — обычная папка на этом компьютере; команды выполняются настоящим sh. */
export class LocalRemote implements Remote {
  puts = 0
  failAfter: number | null = null
  onPut?: (n: number) => void
  exec(cmd: string): Promise<ExecResult> {
    return new Promise((res) => {
      execFile('sh', ['-c', cmd], (err, stdout, stderr) => {
        const c = (err as { code?: unknown } | null)?.code
        res({ code: err ? (typeof c === 'number' ? c : 1) : 0, stdout, stderr })
      })
    })
  }
  async mkdirp(dirs: string[]) { for (const d of dirs) mkdirSync(d, { recursive: true }) }
  async put(local: string, remote: string) {
    this.puts++
    this.onPut?.(this.puts)
    if (this.failAfter !== null && this.puts > this.failAfter) throw new Error('обрыв связи')
    copyFileSync(local, remote)
  }
  close() { /* нечего закрывать */ }
}
