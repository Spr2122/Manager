// Доступ к серверу. Всё, что нужно выкладке, сведено к трём операциям (exec, mkdirp, put),
// поэтому логику выкладки можно проверять и без реального сервера.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Client, utils } from 'ssh2'
import type { ServerConfig } from '../shared/types'
import { AppError } from './fsutil'

export interface ExecResult { code: number; stdout: string; stderr: string }

export interface Remote {
  exec(cmd: string): Promise<ExecResult>
  /** Создаёт каталоги (с родителями). */
  mkdirp(dirs: string[]): Promise<void>
  put(localFile: string, remoteFile: string): Promise<void>
  close(): void
}

/** Экранирование для sh: 'it'\''s'. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export function fingerprintOf(hexSha256: string): string {
  return 'SHA256:' + Buffer.from(hexSha256, 'hex').toString('base64').replace(/=+$/, '')
}
export const fingerprintOfKey = (key: Buffer) => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')

export function describeSshError(e: unknown, cfg: Pick<ServerConfig, 'host' | 'port' | 'username'>): AppError {
  if (e instanceof AppError) return e
  const err = e as NodeJS.ErrnoException & { level?: string }
  const m = String(err?.message ?? e)
  if (/no passphrase given|passphrase/i.test(m) && /encrypted|passphrase/i.test(m)) {
    return new AppError('NEED_SECRET', 'Ключ защищён паролем — введите пассфразу ключа.')
  }
  if (err.code === 'ENOTFOUND') return new AppError('SSH', `Сервер «${cfg.host}» не найден. Проверьте адрес и интернет.`)
  if (err.code === 'ECONNREFUSED') return new AppError('SSH', `Сервер ${cfg.host} отклонил подключение на порту ${cfg.port}. SSH включён? Порт верный?`)
  if (err.code === 'ETIMEDOUT' || /timed out|Timed out/.test(m)) return new AppError('SSH', `Сервер ${cfg.host}:${cfg.port} не отвечает (таймаут). Проверьте адрес, порт и файрвол.`)
  if (/All configured authentication methods failed|Authentication failed/i.test(m)) {
    return new AppError('SSH_AUTH', `Сервер не принял вход пользователя «${cfg.username}». Проверьте, что публичный ключ добавлен в ~/.ssh/authorized_keys этого пользователя (или верен пароль).`)
  }
  if (/ENOENT/.test(m) && /key|pem|id_/i.test(m)) return new AppError('SSH', 'Файл ключа не найден. Проверьте путь в настройках сервера.')
  return new AppError('SSH', `Ошибка подключения: ${m}`)
}

export interface ConnectOptions {
  cfg: ServerConfig
  secret?: string
  /** Какой отпечаток считать доверенным. Пустая строка — не доверять никому (для первого знакомства). */
  trustedFingerprint: string
  onFingerprint?: (fp: string) => void
}

export class FingerprintMismatch extends Error {
  constructor(public seen: string, public expected: string) { super('fingerprint') }
}

export function connect(opts: ConnectOptions): Promise<Remote> {
  const { cfg } = opts
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let seen = ''
    let settled = false
    const fail = (e: unknown) => { if (!settled) { settled = true; try { conn.end() } catch { /* */ } reject(e) } }

    let auth: Record<string, unknown>
    try {
      auth = cfg.authType === 'key'
        ? { privateKey: readFileSync(cfg.keyPath), passphrase: opts.secret || undefined }
        : { password: opts.secret ?? '' }
    } catch (e) {
      return reject(describeSshError(e, cfg))
    }

    conn.on('ready', () => {
      if (settled) return
      settled = true
      conn.sftp((err, sftp) => {
        if (err) return reject(describeSshError(err, cfg))
        resolve(new SshRemote(conn, sftp))
      })
    })
    conn.on('error', (e) => {
      if (seen && opts.trustedFingerprint !== seen) fail(new FingerprintMismatch(seen, opts.trustedFingerprint))
      else fail(describeSshError(e, cfg))
    })
    try {
      conn.connect({
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        ...auth,
        readyTimeout: 20_000,
        keepaliveInterval: 10_000,
        hostHash: 'sha256',
        hostVerifier: (hash: string) => {
          seen = fingerprintOf(hash)
          opts.onFingerprint?.(seen)
          return seen === opts.trustedFingerprint
        }
      } as never)
    } catch (e) {
      fail(describeSshError(e, cfg))
    }
  })
}

type Sftp = Parameters<Parameters<Client['sftp']>[0]>[1]

class SshRemote implements Remote {
  constructor(private conn: Client, private sftp: Sftp) {}

  exec(cmd: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      this.conn.exec(cmd, (err, stream) => {
        if (err) return reject(err)
        let stdout = '', stderr = ''
        stream.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
        stream.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
        stream.on('close', (code: number | null) => resolve({ code: code ?? 1, stdout, stderr }))
      })
    })
  }

  async mkdirp(dirs: string[]): Promise<void> {
    // пачками, чтобы не упереться в ограничение длины командной строки
    for (let i = 0; i < dirs.length; i += 40) {
      const r = await this.exec(`mkdir -p -m 755 ${dirs.slice(i, i + 40).map(shq).join(' ')}`)
      if (r.code !== 0) throw new AppError('REMOTE', `Не удалось создать папки на сервере: ${r.stderr.trim() || r.stdout.trim()}`)
    }
  }

  put(localFile: string, remoteFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.fastPut(localFile, remoteFile, { mode: 0o644, concurrency: 8 }, (err) => (err ? reject(err) : resolve()))
    })
  }

  close(): void { try { this.conn.end() } catch { /* */ } }
}

/** Новая пара ключей ed25519 в формате OpenSSH. */
export function generateKeyPair(comment: string): { privateKey: string; publicKey: string } {
  const k = utils.generateKeyPairSync('ed25519', { comment })
  return { privateKey: k.private, publicKey: k.public.trim() }
}
