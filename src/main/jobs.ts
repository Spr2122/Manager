import { spawn, execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Issue, ProductsFile } from '../shared/types'
import { AppError } from './fsutil'

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
export const stripAnsi = (s: string) => s.replace(ANSI, '')

export interface RunOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  onLine: (line: string) => void
  signal?: AbortSignal
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => undefined)
  else try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* уже завершён */ } }
}

/** Запускает команду, построчно отдаёт вывод. Аргументы — только константы приложения (не ввод пользователя). */
export function runCommand(cmd: string, args: string[], opts: RunOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: process.platform === 'win32', // npm на Windows — это npm.cmd
      detached: process.platform !== 'win32',
      windowsHide: true
    })
    const feed = (buf: Buffer, carry: { v: string }) => {
      carry.v += buf.toString('utf8')
      const lines = carry.v.split(/\r?\n/)
      carry.v = lines.pop() ?? ''
      for (const l of lines) { const t = stripAnsi(l).trimEnd(); if (t) opts.onLine(t) }
    }
    const o = { v: '' }, e = { v: '' }
    child.stdout.on('data', (b) => feed(b, o))
    child.stderr.on('data', (b) => feed(b, e))
    const onAbort = () => killTree(child.pid)
    opts.signal?.addEventListener('abort', onAbort)
    child.on('error', (err: NodeJS.ErrnoException) => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(err.code === 'ENOENT'
        ? new AppError('NO_NODE', 'Не найден Node.js/npm. Установите Node.js LTS с https://nodejs.org и перезапустите приложение.')
        : err)
    })
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      for (const c of [o, e]) if (c.v.trim()) opts.onLine(stripAnsi(c.v).trimEnd())
      if (opts.signal?.aborted) reject(new AppError('CANCELLED', 'Операция отменена'))
      else resolve(code ?? 1)
    })
  })
}

/** Одновременно выполняется только одна тяжёлая операция (сборка, выкладка, …). */
export class JobLock {
  private abort: AbortController | null = null
  private name: string | null = null
  get busy() { return this.name }
  async run<T>(name: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.name) throw new AppError('BUSY', `Сейчас выполняется другая операция («${this.name}»). Дождитесь её окончания.`)
    this.name = name
    this.abort = new AbortController()
    try { return await fn(this.abort.signal) } finally { this.name = null; this.abort = null }
  }
  cancel() { this.abort?.abort() }
}

export interface DistCheckInput {
  root: string
  products: ProductsFile
  siteUrl: string
  /** Включена ли кнопка «Скачать прайс-лист» (по умолчанию да). */
  priceDownload?: boolean
}

/** Проверка собранного dist: то ли это, что нужно выкладывать на боевой сайт. */
export function verifyDist({ root, products, siteUrl, priceDownload = true }: DistCheckInput): Issue[] {
  const issues: Issue[] = []
  const err = (message: string) => issues.push({ severity: 'error', where: 'build', message })
  const warn = (message: string) => issues.push({ severity: 'warning', where: 'build', message })
  const dist = join(root, 'dist')
  const indexFile = join(dist, 'index.html')
  if (!existsSync(indexFile)) { err('В папке dist нет index.html — сборка не завершилась.'); return issues }

  const index = readFileSync(indexFile, 'utf8')
  const origin = siteUrl.replace(/\/+$/, '')
  if (!index.includes(`rel="canonical" href="${origin}/"`)) err(`Главная страница собрана для другого адреса (ожидался ${origin}). Соберите сайт заново.`)
  if (/localhost|127\.0\.0\.1|\.github\.io/.test(index)) err('В собранном сайте остались адреса тестовой среды (localhost / github.io).')
  if (/name="robots" content="[^"]*noindex/.test(index)) err('Сайт собран с запретом индексации (noindex) — так выкладывать на боевой домен нельзя.')

  const robots = join(dist, 'robots.txt')
  if (!existsSync(robots)) warn('Нет robots.txt')
  else if (/^Disallow:\s*\/\s*$/m.test(readFileSync(robots, 'utf8'))) err('robots.txt запрещает индексацию всего сайта.')
  if (!existsSync(join(dist, 'sitemap-index.xml'))) warn('Нет sitemap-index.xml — поисковикам будет сложнее найти страницы.')
  if (!existsSync(join(dist, '404.html'))) warn('Нет страницы 404.html')

  for (const p of products.products) {
    const page = join(dist, 'catalog', p.slug, 'index.html')
    if (p.status === 'published') {
      if (!existsSync(page)) err(`Нет страницы товара «${p.name}» (${p.slug}).`)
      for (const old of p.oldSlugs) if (!existsSync(join(dist, 'catalog', old, 'index.html'))) warn(`Нет редиректа со старого адреса /catalog/${old}/`)
    } else if (existsSync(page)) {
      err(`Черновик «${p.name}» попал в сборку — это не должно происходить.`)
    }
  }
  // Файл прайса есть только у сайтов, где за него отвечает страница src/pages/price/ — у старых версий проверять нечего.
  if (priceDownload && existsSync(join(root, 'src/pages/price')) && !existsSync(join(dist, 'price', 'sorbentopt-price-list.xlsx'))) {
    err('В сборке нет файла прайс-листа для скачивания (price/sorbentopt-price-list.xlsx). Соберите сайт заново или отключите кнопку в «Контент сайта».')
  }
  const size = dirSize(dist)
  if (size > 150 * 1024 * 1024) warn(`Сайт весит ${(size / 1048576).toFixed(0)} МБ — проверьте размер изображений.`)
  return issues
}

export function dirSize(dir: string): number {
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name)
    total += e.isDirectory() ? dirSize(f) : statSync(f).size
  }
  return total
}
