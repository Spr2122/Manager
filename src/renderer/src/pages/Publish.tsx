import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, History, Hammer, Minus, PackageOpen, Play, Plus, Rocket, RotateCcw, Square, Pencil, Undo2, XCircle } from 'lucide-react'
import type { BuildResult, DeployResult, ProgressEvent, ReleaseInfo } from '../../../shared/types'
import { api, parseError } from '../api'
import { goToIssue, useApp } from '../appctx'
import { IssueList, LogConsole, Page, Pill, fmtDate, fmtBytes, useUi } from '../ui'

type JobName = ProgressEvent['job']
const JOB_TITLE: Record<JobName, string> = { install: 'Установка зависимостей', build: 'Сборка сайта', preview: 'Предпросмотр', deploy: 'Выкладка на сервер', rollback: 'Откат версии' }

export default function Publish() {
  const app = useApp()
  const { run, toast, confirm, askSecret } = useUi()
  const { state, preflight } = app
  const [lines, setLines] = useState<string[]>([])
  const [job, setJob] = useState<JobName | null>(null)
  const [prog, setProg] = useState<ProgressEvent | null>(null)
  const [buildRes, setBuildRes] = useState<BuildResult | null>(null)
  const [deployRes, setDeployRes] = useState<DeployResult | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [releases, setReleases] = useState<ReleaseInfo[] | null>(null)

  useEffect(() => {
    const a = api.onLog((e) => setLines((l) => [...l.slice(-400), e.line]))
    const b = api.onProgress((e) => setProg(e))
    return () => { a(); b() }
  }, [])
  useEffect(() => () => { void api.stopPreview() }, [])

  const issues = preflight?.issues ?? []
  const errors = issues.filter((i) => i.severity === 'error')
  const buildErrors = errors.filter((i) => i.stage !== 'deploy')
  const changes = preflight?.changes ?? []
  const build = preflight?.build
  const site = state.site!
  const busy = job !== null

  const start = async <T,>(name: JobName, fn: () => Promise<T>): Promise<T | undefined> => {
    setLines([]); setProg(null); setJob(name)
    try { return await run(fn) } finally { setJob(null); setProg(null); await app.refreshPreflight() }
  }

  /** Запрашивает пароль/пассфразу, если они нужны и не сохранены. */
  const withSecret = async <T,>(fn: (secret?: string) => Promise<T>): Promise<T | undefined> => {
    const cfg = state.config
    let secret: string | undefined
    if (cfg.server.authType === 'password' && !cfg.hasPassword) {
      const s = await askSecret('password')
      if (!s) return undefined
      secret = s.value
      if (s.remember) await run(() => api.setSecret('password', s.value))
    }
    try { return await fn(secret) } catch (e) {
      const pe = parseError(e)
      if (pe.code !== 'NEED_SECRET') { toast('error', pe.message); return undefined }
      const s = await askSecret('passphrase', pe.message)
      if (!s) return undefined
      if (s.remember) await run(() => api.setSecret('passphrase', s.value))
      try { return await fn(s.value) } catch (e2) { toast('error', parseError(e2).message); return undefined }
    }
  }

  const doInstall = async () => { await start('install', () => api.installDeps()); await app.refreshState(); toast('success', 'Зависимости установлены') }
  const doBuild = async () => {
    setDeployRes(null)
    const r = await start('build', () => api.build())
    if (r) { setBuildRes(r); toast(r.ok ? 'success' : 'error', r.ok ? `Сайт собран за ${(r.durationMs / 1000).toFixed(1)} с` : 'Сборка не прошла проверку — см. ниже') }
  }
  const doPreview = async () => {
    const url = await run(() => api.startPreview())
    if (url) { setPreviewUrl(url); await api.openPreviewUrl() }
  }
  const stopPreview = async () => { await api.stopPreview(); setPreviewUrl(null) }
  const loadReleases = useCallback(async () => {
    const r = await withSecret((secret) => api.listReleases({ secret }))
    if (r) setReleases(r)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const doDeploy = async () => {
    const ok = await confirm({
      title: 'Выложить сайт на сервер?',
      text: `Новая версия будет загружена на ${state.config.server.host} и станет видна всем на ${state.config.siteUrl}. Изменений: ${changes.length}. Предыдущую версию можно будет вернуть одной кнопкой.`,
      ok: 'Выложить'
    })
    if (!ok) return
    const r = await start('deploy', () => withSecret((secret) => api.deploy({ secret })).then((v) => { if (!v) throw new Error('[CANCELLED] Выкладка не выполнена'); return v }))
    if (r) {
      setDeployRes(r); setReleases(null)
      toast(r.health?.ok === false ? 'info' : 'success', r.health?.ok === false ? 'Выложено, но проверка сайта не пройдена — см. ниже' : 'Сайт обновлён')
    }
  }
  const doRollback = async (id: string) => {
    if (!(await confirm({ title: 'Вернуть версию?', text: `Сайт сразу переключится на версию ${id}. Текущая останется на сервере — можно будет вернуться обратно.`, ok: 'Вернуть' }))) return
    const r = await start('rollback', () => withSecret((secret) => api.rollback(id, { secret })).then((v) => { if (!v) throw new Error('[CANCELLED] Откат не выполнен'); return v }))
    if (r) { setDeployRes(r); toast('success', 'Версия возвращена'); await loadReleases() }
  }

  const canBuild = !busy && buildErrors.length === 0 && site.depsInstalled
  const canDeploy = !busy && errors.length === 0 && build?.fresh === true
  const deployHint = errors.length ? 'Сначала исправьте ошибки' : !build?.builtAt ? 'Сначала соберите сайт' : !build.fresh ? 'Данные изменились после сборки — соберите заново' : changes.length === 0 ? 'Изменений нет — можно выложить повторно' : ''

  return (
    <Page title="Публикация" subtitle="Проверить → собрать → посмотреть → выложить на сервер">
      <div className="card">
        <div className="card-head"><h2><span className="num">1</span> Проверка</h2>
          {errors.length === 0 ? <Pill kind="ok"><CheckCircle2 size={12} /> Ошибок нет</Pill> : <Pill kind="bad"><XCircle size={12} /> Ошибок: {errors.length}</Pill>}</div>
        <IssueList issues={issues} onGo={(w) => goToIssue(app, w)} />
        {issues.length === 0 && <p className="muted-text">Всё в порядке.</p>}
        <h3 className="sub">Что изменится на сайте</h3>
        {changes.length === 0 ? <p className="muted-text">Сайт на сервере совпадает с приложением.{!preflight?.lastDeploy && ' (Выкладок ещё не было.)'}</p> : (
          <ul className="changes">
            {changes.map((c, i) => (
              <li key={i} className={c.kind}>
                <span className="kind">{c.kind === 'added' ? <Plus size={14} /> : c.kind === 'removed' ? <Minus size={14} /> : <Pencil size={13} />}</span>
                <div><strong>{c.title}</strong>{c.details.map((d, k) => <small key={k}>{d}</small>)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2><span className="num">2</span> Сборка</h2>
          {build?.builtAt ? (build.fresh ? <Pill kind="ok"><CheckCircle2 size={12} /> Актуальна · {fmtDate(build.builtAt)}</Pill> : <Pill kind="warn">Устарела · {fmtDate(build.builtAt)}</Pill>) : <Pill kind="muted">Не выполнялась</Pill>}</div>
        <p className="muted-text">Из данных каталога и настроек собирается готовый сайт для адреса <b>{state.config.siteUrl}</b>.</p>
        <div className="btn-row">
          {!site.depsInstalled && <button className="btn primary" disabled={busy} onClick={doInstall}><PackageOpen size={16} /> Установить зависимости</button>}
          <button className={`btn ${site.depsInstalled ? 'primary' : ''}`} disabled={!canBuild} onClick={doBuild}><Hammer size={16} /> Собрать сайт</button>
          {!site.depsInstalled && <small className="muted-text">Нужно один раз (требуется Node.js и интернет)</small>}
          {buildErrors.length > 0 && site.depsInstalled && <small className="err">Исправьте ошибки проверки</small>}
        </div>
        {buildRes && !buildRes.ok && <IssueList issues={buildRes.issues} />}
        {buildRes?.ok && buildRes.issues.length > 0 && <IssueList issues={buildRes.issues} />}
      </div>

      <div className="card">
        <div className="card-head"><h2><span className="num">3</span> Предпросмотр</h2>{previewUrl && <Pill kind="ok">Запущен</Pill>}</div>
        <p className="muted-text">Откроет собранный сайт в браузере на этом компьютере — как он будет выглядеть для посетителей.</p>
        <div className="btn-row">
          {!previewUrl ? <button className="btn" disabled={busy || !build?.builtAt} onClick={doPreview}><Play size={16} /> Открыть предпросмотр</button> : <>
            <button className="btn" onClick={() => api.openPreviewUrl()}><ExternalLink size={16} /> Открыть {previewUrl}</button>
            <button className="btn" onClick={stopPreview}><Square size={14} /> Остановить</button></>}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2><span className="num">4</span> Выкладка на сервер</h2>
          <small className="muted-text">{state.config.server.host ? `${state.config.server.username}@${state.config.server.host}` : 'сервер не настроен'}</small></div>
        <div className="btn-row">
          <button className="btn primary big" disabled={!canDeploy} onClick={doDeploy}><Rocket size={18} /> Выложить на сайт</button>
          {deployHint && <small className={errors.length || !build?.fresh ? 'err' : 'muted-text'}>{deployHint}</small>}
        </div>
        {deployRes && (
          <div className={`callout ${deployRes.health === null || deployRes.health.ok ? 'ok' : 'warn'}`}>
            <CheckCircle2 size={18} />
            <div>
              <strong>{deployRes.files ? `Версия ${deployRes.releaseId} выложена` : `Сайт переключён на версию ${deployRes.releaseId}`}</strong>
              {deployRes.files > 0 && <div>{deployRes.files} файлов, {fmtBytes(deployRes.bytes)}</div>}
              {deployRes.health && <div>{deployRes.health.message}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2><History size={18} /> Версии на сервере</h2>
          <button className="btn small" disabled={busy || !state.config.server.host} onClick={loadReleases}>Показать</button></div>
        {!releases ? <p className="muted-text">Список загружается с сервера по кнопке. Любую версию можно вернуть.</p> : releases.length === 0 ? <p className="muted-text">На сервере пока нет версий.</p> : (
          <ul className="releases">
            {releases.map((r) => (
              <li key={r.id}><code>{r.id}</code>{r.current ? <Pill kind="ok">Сейчас на сайте</Pill> : <button className="btn small" disabled={busy} onClick={() => doRollback(r.id)}><Undo2 size={14} /> Вернуть эту версию</button>}</li>
            ))}
          </ul>
        )}
      </div>

      {(busy || lines.length > 0) && (
        <div className="card">
          <div className="card-head"><h2><RotateCcw size={16} className={busy ? 'spin' : ''} /> {job ? JOB_TITLE[job] : 'Журнал'}</h2>
            {busy && <button className="btn small danger" onClick={() => api.cancelJob()}>Отменить</button>}</div>
          {busy && prog && (
            <div className="progress"><div className="bar"><i style={{ width: prog.fraction === null ? '35%' : `${Math.round(prog.fraction * 100)}%` }} className={prog.fraction === null ? 'indeterminate' : ''} /></div><small>{prog.phase}</small></div>
          )}
          <LogConsole lines={lines} />
        </div>
      )}
    </Page>
  )
}
