// Выкладка «релизами»: загрузка в releases/<время>, проверка, атомарное переключение ссылки current.
// Посетитель никогда не видит половину сайта, откат — это переключение ссылки обратно.
import { readdirSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import type { DeployResult, ReleaseInfo } from '../shared/types'
import { AppError } from './fsutil'
import type { Remote } from './remote'
import { shq } from './remote'

export const RELEASE_RE = /^\d{8}-\d{6}(?:-[a-z0-9]+)?$/

export function validateRemoteBase(base: string): string {
  const b = base.trim().replace(/\/+$/, '')
  if (!/^\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/.test(b) || b.split('/').includes('..')) {
    throw new AppError('BAD_CONFIG', 'Папка на сервере должна быть абсолютным путём из двух и более частей, например /var/www/sorbentopt')
  }
  return b
}

export function newReleaseId(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

interface LocalFile { abs: string; rel: string; size: number }

export function walkFiles(root: string): LocalFile[] {
  const out: LocalFile[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (e.isFile()) out.push({ abs, rel: relative(root, abs).split(sep).join('/'), size: statSync(abs).size })
    }
  }
  walk(root)
  return out
}

export type Progress = (phase: string, fraction: number | null) => void

async function must(remote: Remote, cmd: string, what: string): Promise<string> {
  const r = await remote.exec(cmd)
  if (r.code !== 0) throw new AppError('REMOTE', `${what}: ${r.stderr.trim() || r.stdout.trim() || 'код ' + r.code}`)
  return r.stdout.trim()
}

export async function currentRelease(remote: Remote, base: string): Promise<string | null> {
  const r = await remote.exec(`readlink ${shq(base + '/current')}`)
  if (r.code !== 0) return null
  const id = posix.basename(r.stdout.trim())
  return RELEASE_RE.test(id) ? id : null
}

export async function listReleases(remote: Remote, base: string): Promise<ReleaseInfo[]> {
  const r = await remote.exec(`ls -1 ${shq(base + '/releases')}`)
  if (r.code !== 0) return []
  const cur = await currentRelease(remote, base)
  return r.stdout.split('\n').map((s) => s.trim()).filter((s) => RELEASE_RE.test(s)).sort().reverse().map((id) => ({ id, current: id === cur }))
}

/** Атомарное переключение: новая ссылка создаётся рядом и «переименовывается» поверх старой. */
export async function switchRelease(remote: Remote, base: string, id: string): Promise<void> {
  if (!RELEASE_RE.test(id)) throw new AppError('BAD_RELEASE', 'Некорректное имя версии')
  await must(remote, `test -d ${shq(`${base}/releases/${id}`)}`, 'Такой версии нет на сервере')
  await must(remote, `cd ${shq(base)} && ln -sfn ${shq('releases/' + id)} current.new && mv -Tf current.new current`, 'Не удалось переключить версию')
}

async function prune(remote: Remote, base: string, keep: number): Promise<number> {
  const all = await listReleases(remote, base)
  const protectedIds = new Set(all.filter((r) => r.current).map((r) => r.id))
  const victims = all.slice(Math.max(1, keep)).filter((r) => !protectedIds.has(r.id))
  for (const v of victims) await remote.exec(`rm -rf -- ${shq(`${base}/releases/${v.id}`)}`)
  return victims.length
}

export interface DeployParams {
  remote: Remote
  base: string
  localDist: string
  keep: number
  onProgress: Progress
  signal?: AbortSignal
  releaseId?: string
}

export async function deployRelease(params: DeployParams): Promise<Omit<DeployResult, 'health'>> {
  const { remote, localDist, onProgress, signal } = params
  const base = validateRemoteBase(params.base)
  let releaseId = params.releaseId ?? newReleaseId()
  let releaseDir = `${base}/releases/${releaseId}`
  const cancelled = () => { if (signal?.aborted) throw new AppError('CANCELLED', 'Выкладка отменена — на сайте осталась прежняя версия.') }

  onProgress('Проверка сервера', null)
  await must(remote, `test -d ${shq(base)} && test -w ${shq(base)}`,
    `Папка ${base} не существует или нет прав на запись. Выполните deploy/setup-vps.sh на сервере`)
  const cur = (await remote.exec(`if [ -e ${shq(base + '/current')} ] && [ ! -L ${shq(base + '/current')} ]; then echo REALDIR; fi`)).stdout.trim()
  if (cur === 'REALDIR') {
    throw new AppError('REMOTE', `${base}/current — обычная папка, а не ссылка. Переименуйте её на сервере (mv current current.old) и повторите.`)
  }
  const files = walkFiles(localDist)
  if (!files.some((f) => f.rel === 'index.html')) throw new AppError('BAD_BUILD', 'В dist нет index.html — сначала соберите сайт.')
  const bytes = files.reduce((s, f) => s + f.size, 0)

  const df = await remote.exec(`mkdir -p ${shq(base + '/releases')} && df -Pk ${shq(base)} | awk 'NR==2{print $4}'`)
  const freeKb = Number(df.stdout.trim())
  if (Number.isFinite(freeKb) && freeKb > 0 && freeKb * 1024 < bytes * 2 + 50 * 1024 * 1024) {
    throw new AppError('REMOTE', `На сервере мало места: свободно ${(freeKb / 1024).toFixed(0)} МБ, а нужно примерно ${((bytes * 2) / 1048576 + 50).toFixed(0)} МБ.`)
  }
  const previousId = await currentRelease(remote, base)
  // две выкладки в одну секунду не должны смешаться в одной папке
  for (let n = 2; (await remote.exec(`test -e ${shq(releaseDir)}`)).code === 0; n++) {
    releaseId = `${params.releaseId ?? newReleaseId()}-${n}`
    releaseDir = `${base}/releases/${releaseId}`
  }

  try {
    cancelled()
    onProgress('Создание папок', null)
    const dirs = new Set<string>([releaseDir])
    for (const f of files) { const d = posix.dirname(f.rel); if (d !== '.') dirs.add(`${releaseDir}/${d}`) }
    await remote.mkdirp([...dirs].sort())

    let done = 0
    let next = 0
    const worker = async () => {
      while (next < files.length) {
        cancelled()
        const f = files[next++]
        await remote.put(f.abs, `${releaseDir}/${f.rel}`)
        onProgress(`Загрузка файлов (${++done} из ${files.length})`, done / files.length)
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker))

    cancelled()
    onProgress('Проверка загруженного', null)
    await must(remote, `printf '%s\\n' ${shq(releaseId)} > ${shq(releaseDir + '/release.txt')}`, 'Не удалось записать метку версии')
    const count = Number(await must(remote, `find ${shq(releaseDir)} -type f | wc -l`, 'Не удалось проверить загрузку'))
    if (count !== files.length + 1) {
      throw new AppError('REMOTE', `После загрузки на сервере ${count} файлов, ожидалось ${files.length + 1}. Версия не опубликована, повторите выкладку.`)
    }
    cancelled()
    onProgress('Переключение на новую версию', null)
    await switchRelease(remote, base, releaseId)
  } catch (e) {
    // до переключения сайт не затронут; убираем недозагруженную папку
    await remote.exec(`rm -rf -- ${shq(releaseDir)}`).catch(() => undefined)
    throw e
  }

  onProgress('Очистка старых версий', null)
  await prune(remote, base, params.keep).catch(() => undefined)
  return { releaseId, previousId, files: files.length, bytes }
}

/** Проверка с самого сайта: отдаёт ли он только что выложенную версию. */
export async function checkHealth(
  siteUrl: string, releaseId: string,
  fetchFn: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<{ ok: boolean; message: string }> {
  const url = `${siteUrl.replace(/\/+$/, '')}/release.txt?t=${Date.now()}`
  let last = ''
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store', redirect: 'follow' })
      if (res.ok) {
        const body = (await res.text()).trim()
        if (body === releaseId) return { ok: true, message: 'Сайт открывается и отдаёт новую версию.' }
        last = `сайт отвечает, но отдаёт другую версию («${body.slice(0, 40)}»)`
      } else last = `сайт ответил кодом ${res.status}`
    } catch (e) {
      const m = (e as Error).message
      last = /timeout|aborted/i.test(m) ? 'сайт не ответил за 15 секунд' : `не удалось подключиться к сайту (${m})`
    }
    if (i < 2) await sleep(2000)
  }
  return { ok: false, message: `Файлы загружены и переключены, но проверка не пройдена: ${last}. Если домен ещё не настроен — это нормально; иначе проверьте Caddy или откатитесь.` }
}
