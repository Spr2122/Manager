import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkHealth, currentRelease, deployRelease, listReleases, newReleaseId, switchRelease, validateRemoteBase, walkFiles } from '../src/main/deploy'
import { shq } from '../src/main/remote'
import { LocalRemote, rm } from './helpers'

const dirs: string[] = []
const mk = () => { const d = mkdtempSync(join(tmpdir(), 'sopt-srv-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) rm(dirs.pop()!) })

/** Локальная «сборка» с вложенными папками, пробелом и кириллицей в имени. */
function fakeDist(tag = 'v1'): string {
  const d = mk()
  mkdirSync(join(d, 'catalog/glaukonit'), { recursive: true }); mkdirSync(join(d, '_astro'))
  writeFileSync(join(d, 'index.html'), `<html>${tag}</html>`)
  writeFileSync(join(d, 'catalog/glaukonit/index.html'), tag)
  writeFileSync(join(d, '_astro/app.abc123.css'), 'a{}')
  writeFileSync(join(d, "it's a файл.txt"), 'кириллица и кавычка')
  return d
}
const server = () => { const base = join(mk(), 'www', 'site'); mkdirSync(join(base, 'releases'), { recursive: true }); return base }
const ids = (id: string) => ({ releaseId: id })

describe('валидация папки на сервере', () => {
  it('принимает нормальные и отвергает опасные пути', () => {
    expect(validateRemoteBase('/var/www/sorbentopt/')).toBe('/var/www/sorbentopt')
    for (const bad of ['/', '/var', 'var/www/x', '/var/www/../etc', '/var/www/a b', "/var/www/a'; rm -rf /", '/var/www/$(x)', '']) expect(() => validateRemoteBase(bad)).toThrow()
  })
  it('экранирует кавычки для sh', () => { expect(shq("a'b")).toBe(`'a'\\''b'`) })
  it('идентификатор версии: UTC, сортируется по времени', () => {
    expect(newReleaseId(new Date(Date.UTC(2026, 11, 1, 9, 5, 7)))).toBe('20261201-090507')
  })
})

describe('выкладка релизами', () => {
  it('загружает всё, включая странные имена, и переключает ссылку', async () => {
    const base = server(), dist = fakeDist(), remote = new LocalRemote()
    const r = await deployRelease({ remote, base, localDist: dist, keep: 5, onProgress: () => undefined, ...ids('20261201-100000') })
    expect(r).toMatchObject({ releaseId: '20261201-100000', previousId: null, files: 4 })
    expect(lstatSync(join(base, 'current')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(base, 'current'))).toBe('releases/20261201-100000')
    const live = join(base, 'current')
    expect(readFileSync(join(live, 'index.html'), 'utf8')).toBe('<html>v1</html>')
    expect(readFileSync(join(live, "it's a файл.txt"), 'utf8')).toBe('кириллица и кавычка')
    expect(readFileSync(join(live, 'release.txt'), 'utf8').trim()).toBe('20261201-100000')
    expect(existsSync(join(base, 'current.new'))).toBe(false)
    expect(walkFiles(dist)).toHaveLength(4)
  })

  it('вторая выкладка помнит предыдущую; откат и «вперёд» работают', async () => {
    const base = server(), remote = new LocalRemote()
    await deployRelease({ remote, base, localDist: fakeDist('v1'), keep: 5, onProgress: () => undefined, ...ids('20261201-100000') })
    const r2 = await deployRelease({ remote, base, localDist: fakeDist('v2'), keep: 5, onProgress: () => undefined, ...ids('20261202-100000') })
    expect(r2.previousId).toBe('20261201-100000')
    expect(readFileSync(join(base, 'current/index.html'), 'utf8')).toContain('v2')
    expect((await listReleases(remote, base)).map((x) => [x.id, x.current])).toEqual([['20261202-100000', true], ['20261201-100000', false]])
    await switchRelease(remote, base, '20261201-100000')
    expect(readFileSync(join(base, 'current/index.html'), 'utf8')).toContain('v1')
    expect(await currentRelease(remote, base)).toBe('20261201-100000')
    await expect(switchRelease(remote, base, '20269999-000000')).rejects.toThrow(/нет на сервере/)
    await expect(switchRelease(remote, base, '../../etc')).rejects.toThrow(/Некорректное/)
  })

  it('хранит только N версий, но никогда не удаляет текущую', async () => {
    const base = server(), remote = new LocalRemote()
    for (const day of ['01', '02', '03', '04', '05']) {
      await deployRelease({ remote, base, localDist: fakeDist(day), keep: 3, onProgress: () => undefined, ...ids(`202612${day}-100000`) })
    }
    expect(readdirSync(join(base, 'releases')).sort()).toEqual(['20261203-100000', '20261204-100000', '20261205-100000'])
    // откатились на самую старую из оставшихся, затем выкладка новой — откатная версия не должна исчезнуть, пока она текущая
    await switchRelease(remote, base, '20261203-100000')
    await deployRelease({ remote, base, localDist: fakeDist('06'), keep: 2, onProgress: () => undefined, ...ids('20261206-100000') })
    expect(await currentRelease(remote, base)).toBe('20261206-100000')
    expect(readdirSync(join(base, 'releases')).sort()).toEqual(['20261205-100000', '20261206-100000'])
  })

  it('обрыв связи на середине: сайт не затронут, недогруженная папка убрана', async () => {
    const base = server(), remote = new LocalRemote()
    await deployRelease({ remote, base, localDist: fakeDist('good'), keep: 5, onProgress: () => undefined, ...ids('20261201-100000') })
    remote.failAfter = remote.puts + 2
    await expect(deployRelease({ remote, base, localDist: fakeDist('bad'), keep: 5, onProgress: () => undefined, ...ids('20261202-100000') })).rejects.toThrow(/обрыв/)
    expect(readFileSync(join(base, 'current/index.html'), 'utf8')).toContain('good')
    expect(readdirSync(join(base, 'releases'))).toEqual(['20261201-100000'])
  })

  it('отмена пользователем останавливает загрузку без вреда для сайта', async () => {
    const base = server(), remote = new LocalRemote(), ac = new AbortController()
    await deployRelease({ remote, base, localDist: fakeDist('good'), keep: 5, onProgress: () => undefined, ...ids('20261201-100000') })
    remote.onPut = (n) => { if (n === remote.puts) ac.abort() }
    await expect(deployRelease({ remote, base, localDist: fakeDist('new'), keep: 5, signal: ac.signal, onProgress: () => undefined, ...ids('20261202-100000') })).rejects.toThrow(/отменена/)
    expect(await currentRelease(remote, base)).toBe('20261201-100000')
    expect(readdirSync(join(base, 'releases'))).toEqual(['20261201-100000'])
  })

  it('две выкладки в одну секунду не смешиваются', async () => {
    const base = server(), remote = new LocalRemote()
    const a = await deployRelease({ remote, base, localDist: fakeDist('a'), keep: 5, onProgress: () => undefined, ...ids('20261201-100000') })
    const b = await deployRelease({ remote, base, localDist: fakeDist('b'), keep: 5, onProgress: () => undefined, ...ids('20261201-100000') })
    expect(b.releaseId).toBe('20261201-100000-2'); expect(a.releaseId).not.toBe(b.releaseId)
    expect(readFileSync(join(base, 'current/index.html'), 'utf8')).toContain('b')
    expect(await currentRelease(remote, base)).toBe('20261201-100000-2')
  })

  it('понятные ошибки: нет папки, current — обычная папка, пустая сборка', async () => {
    const remote = new LocalRemote(), dist = fakeDist()
    const none = join(mk(), 'www', 'nope')
    await expect(deployRelease({ remote, base: none, localDist: dist, keep: 5, onProgress: () => undefined })).rejects.toThrow(/setup-vps/)
    const base = server(); mkdirSync(join(base, 'current'))
    await expect(deployRelease({ remote, base, localDist: dist, keep: 5, onProgress: () => undefined })).rejects.toThrow(/обычная папка/)
    const base2 = server(); const empty = mk()
    await expect(deployRelease({ remote, base: base2, localDist: empty, keep: 5, onProgress: () => undefined })).rejects.toThrow(/index.html/)
    expect(readdirSync(join(base2, 'releases'))).toEqual([])
  })

  it('чужие папки в releases/ не трогает', async () => {
    const base = server(), remote = new LocalRemote()
    mkdirSync(join(base, 'releases', 'my-notes')); symlinkSync('releases', join(base, 'x'))
    for (const day of ['01', '02', '03']) await deployRelease({ remote, base, localDist: fakeDist(day), keep: 2, onProgress: () => undefined, ...ids(`202612${day}-100000`) })
    expect(readdirSync(join(base, 'releases')).sort()).toEqual(['20261202-100000', '20261203-100000', 'my-notes'])
  })
})

describe('проверка сайта после выкладки', () => {
  const resp = (status: number, body = '') => async () => new Response(body, { status })
  const noSleep = async () => undefined
  it('успех, когда сайт отдаёт нужную версию', async () => {
    expect((await checkHealth('https://x.ru/', 'R1', resp(200, 'R1\n') as never, noSleep)).ok).toBe(true)
  })
  it('сообщает, что отдаётся другая версия, код ответа и недоступность', async () => {
    expect((await checkHealth('https://x.ru', 'R1', resp(200, 'R0') as never, noSleep)).message).toMatch(/другую версию/)
    expect((await checkHealth('https://x.ru', 'R1', resp(404) as never, noSleep)).message).toMatch(/404/)
    const down = async () => { throw new Error('getaddrinfo ENOTFOUND x.ru') }
    expect((await checkHealth('https://x.ru', 'R1', down as never, noSleep)).message).toMatch(/не удалось подключиться/)
  })
  it('повторяет попытки и принимает успех со второй', async () => {
    let n = 0
    const flaky = async () => (++n < 2 ? new Response('', { status: 502 }) : new Response('R1'))
    expect((await checkHealth('https://x.ru', 'R1', flaky as never, noSleep)).ok).toBe(true); expect(n).toBe(2)
  })
})
