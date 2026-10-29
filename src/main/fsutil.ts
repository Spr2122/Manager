import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

export class AppError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

/** Путь вида «/images/x.webp» внутри base. Выход за пределы папки (../) запрещён. */
export function resolveInside(base: string, sitePath: string): string {
  if (!sitePath.startsWith('/')) throw new AppError('BAD_PATH', 'Путь должен начинаться с «/»')
  const full = resolve(base, '.' + sitePath)
  const root = resolve(base)
  if (full !== root && !full.startsWith(root + sep)) throw new AppError('BAD_PATH', 'Недопустимый путь')
  return full
}

/** Запись «целиком или никак»: во временный файл, затем переименование. Повтор при блокировке антивирусом (Windows). */
export function atomicWrite(file: string, data: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, data)
  let lastErr: unknown
  for (let i = 0; i < 6; i++) {
    try {
      renameSync(tmp, file)
      return
    } catch (e) {
      lastErr = e
      const end = Date.now() + 80 * (i + 1)
      while (Date.now() < end) { /* короткая пауза */ }
    }
  }
  try { unlinkSync(tmp) } catch { /* ignore */ }
  throw lastErr
}

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as T
}

export const fileSize = (f: string) => (existsSync(f) ? statSync(f).size : 0)

export function stamp(d = new Date()): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}
