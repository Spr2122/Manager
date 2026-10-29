// Интеграционный тест: настоящий SSH-клиент приложения против тестового SSH-сервера (ssh2.Server).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Server, utils } from 'ssh2'
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { FingerprintMismatch, connect, fingerprintOf, generateKeyPair } from '../src/main/remote'
import { currentRelease, deployRelease, listReleases, switchRelease } from '../src/main/deploy'
import type { ServerConfig } from '../src/shared/types'
import { rm } from './helpers'

const { STATUS_CODE, flagsToString } = utils.sftp
const hostKey = utils.generateKeyPairSync('ed25519').private
const otherHostKey = utils.generateKeyPairSync('ed25519').private
const userKeys = generateKeyPair('test')
const wrongKeys = generateKeyPair('wrong')
const PASSWORD = 's3cret'

function startServer(key: string): Promise<{ server: Server; port: number; fp: string }> {
  const fpOf = (k: string) => {
    const parsed = utils.parseKey(k) as { getPublicSSH(): Buffer }
    return 'SHA256:' + require('node:crypto').createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')
  }
  const allowed = utils.parseKey(userKeys.publicKey) as { getPublicSSH(): Buffer; verify(b: Buffer, s: Buffer, h?: string): boolean }
  const server = new Server({ hostKeys: [key] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.password === PASSWORD) return ctx.accept()
      if (ctx.method === 'publickey' && ctx.key.data.equals(allowed.getPublicSSH())) {
        if (!ctx.signature) return ctx.accept()
        return allowed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) ? ctx.accept() : ctx.reject()
      }
      ctx.reject(['publickey', 'password'])
    })
    client.on('ready', () => client.on('session', (accept) => {
      const session = accept()
      session.on('exec', (acc, _rej, info) => {
        const stream = acc()
        const p = spawn('sh', ['-c', info.command])
        p.stdout.on('data', (d) => stream.write(d)); p.stderr.on('data', (d) => stream.stderr.write(d))
        p.on('close', (code) => { stream.exit(code ?? 1); stream.end() })
      })
      session.on('sftp', (acc) => {
        const sftp = acc(); const fds = new Map<number, number>(); let next = 1
        sftp.on('OPEN', (id, path, flags) => {
          try { const fd = openSync(path, flagsToString(flags) as string, 0o644); const h = next++; fds.set(h, fd); const b = Buffer.alloc(4); b.writeUInt32BE(h); sftp.handle(id, b) }
          catch { sftp.status(id, STATUS_CODE.FAILURE) }
        })
        sftp.on('WRITE', (id, h, offset, data) => { try { writeSync(fds.get(h.readUInt32BE())!, data, 0, data.length, offset); sftp.status(id, STATUS_CODE.OK) } catch { sftp.status(id, STATUS_CODE.FAILURE) } })
        sftp.on('CLOSE', (id, h) => { try { closeSync(fds.get(h.readUInt32BE())!) } catch { /* */ } sftp.status(id, STATUS_CODE.OK) })
        sftp.on('FSETSTAT', (id) => sftp.status(id, STATUS_CODE.OK))
        sftp.on('SETSTAT', (id) => sftp.status(id, STATUS_CODE.OK))
        sftp.on('FSTAT', (id) => sftp.attrs(id, { mode: 0o100644, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 }))
      })
    }))
    client.on('error', () => undefined)
  })
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, port: (server.address() as AddressInfo).port, fp: fpOf(key) })))
}

let srv: Awaited<ReturnType<typeof startServer>>
let srv2: Awaited<ReturnType<typeof startServer>>
const tmp: string[] = []
const keyFile = (k: { privateKey: string }) => { const d = mkdtempSync(join(tmpdir(), 'sopt-key-')); tmp.push(d); const f = join(d, 'id'); writeFileSync(f, k.privateKey + '\n', { mode: 0o600 }); return f }
const cfg = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  host: '127.0.0.1', port: srv.port, username: 'deploy', authType: 'key', keyPath: keyFile(userKeys),
  remoteBase: '/x/y', keepReleases: 5, fingerprint: '', ...over
})

beforeAll(async () => { srv = await startServer(hostKey); srv2 = await startServer(otherHostKey) })
afterAll(() => { srv.server.close(); srv2.server.close(); tmp.forEach(rm) })

describe('SSH: проверка сервера и вход', () => {
  it('отпечаток формата OpenSSH', () => { expect(fingerprintOf('00'.repeat(32))).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/) })

  it('незнакомый сервер: подключение отклоняется и сообщается его отпечаток', async () => {
    const e = await connect({ cfg: cfg(), trustedFingerprint: '' }).catch((x) => x)
    expect(e).toBeInstanceOf(FingerprintMismatch)
    expect((e as FingerprintMismatch).seen).toBe(srv.fp)
  })
  it('подтверждённый отпечаток пускает; подменённый сервер — нет', async () => {
    const ok = await connect({ cfg: cfg(), trustedFingerprint: srv.fp })
    expect((await ok.exec('echo привет')).stdout.trim()).toBe('привет'); ok.close()
    const evil = await connect({ cfg: cfg({ port: srv2.port }), trustedFingerprint: srv.fp }).catch((x) => x)
    expect(evil).toBeInstanceOf(FingerprintMismatch); expect((evil as FingerprintMismatch).seen).toBe(srv2.fp)
  })
  it('вход по паролю; неверный пароль и неверный ключ — понятные ошибки', async () => {
    const r = await connect({ cfg: cfg({ authType: 'password' }), secret: PASSWORD, trustedFingerprint: srv.fp }); r.close()
    await expect(connect({ cfg: cfg({ authType: 'password' }), secret: 'nope', trustedFingerprint: srv.fp })).rejects.toThrow(/не принял вход/)
    await expect(connect({ cfg: cfg({ keyPath: keyFile(wrongKeys) }), trustedFingerprint: srv.fp })).rejects.toThrow(/не принял вход/)
  })
  it('ключ с паролем: без пассфразы — просьба ввести, с ней — вход', async () => {
    const enc = utils.generateKeyPairSync('ed25519', { passphrase: 'pp', cipher: 'aes256-ctr' } as never)
    const bad = await connect({ cfg: cfg({ keyPath: keyFile({ privateKey: enc.private }) }), trustedFingerprint: srv.fp }).catch((x) => x)
    expect(bad.code).toBe('NEED_SECRET')
  })
  it('понятные ошибки сети и файла ключа', async () => {
    await expect(connect({ cfg: cfg({ port: 1 }), trustedFingerprint: srv.fp })).rejects.toThrow(/отклонил подключение/)
    await expect(connect({ cfg: cfg({ keyPath: '/no/such/key' }), trustedFingerprint: srv.fp })).rejects.toThrow(/Файл ключа/)
  })
})

describe('SSH: выкладка целиком через настоящий протокол', () => {
  it('загрузка, переключение, откат, очистка', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sopt-ssh-')); tmp.push(root)
    const base = join(root, 'var', 'www'); mkdirSync(join(base, 'releases'), { recursive: true })
    const dist = (tag: string) => {
      const d = mkdtempSync(join(tmpdir(), 'sopt-d-')); tmp.push(d)
      mkdirSync(join(d, 'catalog/a b'), { recursive: true })
      writeFileSync(join(d, 'index.html'), tag); writeFileSync(join(d, 'catalog/a b/index.html'), 'товар ' + tag)
      for (let i = 0; i < 25; i++) writeFileSync(join(d, `f${i}.txt`), 'x'.repeat(1000 * i))
      return d
    }
    const remote = await connect({ cfg: cfg(), trustedFingerprint: srv.fp })
    try {
      const phases: string[] = []
      const a = await deployRelease({ remote, base, localDist: dist('v1'), keep: 2, releaseId: '20261201-100000', onProgress: (p) => phases.push(p) })
      expect(a.files).toBe(27)
      expect(phases.some((p) => /Загрузка файлов \(27 из 27\)/.test(p))).toBe(true)
      expect(readFileSync(join(base, 'current/catalog/a b/index.html'), 'utf8')).toBe('товар v1')
      expect(readFileSync(join(base, 'current/f24.txt'), 'utf8')).toHaveLength(24000)
      await deployRelease({ remote, base, localDist: dist('v2'), keep: 2, releaseId: '20261202-100000', onProgress: () => undefined })
      await deployRelease({ remote, base, localDist: dist('v3'), keep: 2, releaseId: '20261203-100000', onProgress: () => undefined })
      expect((await listReleases(remote, base)).map((r) => r.id)).toEqual(['20261203-100000', '20261202-100000'])
      await switchRelease(remote, base, '20261202-100000')
      expect(await currentRelease(remote, base)).toBe('20261202-100000')
      expect(readFileSync(join(base, 'current/index.html'), 'utf8')).toBe('v2')
      expect(readdirSync(base).sort()).toEqual(['current', 'releases'])
    } finally { remote.close() }
  }, 60_000)
})
