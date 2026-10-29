import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Clock, Rocket } from 'lucide-react'
import type { ChangeLogEntry } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../appctx'
import { Page, fmtDate } from '../ui'

export default function Dashboard() {
  const app = useApp()
  const { state, preflight } = app
  const [log, setLog] = useState<ChangeLogEntry[]>([])
  useEffect(() => { api.getChangelog(8).then(setLog).catch(() => setLog([])) }, [preflight])

  const site = state.site!
  const issues = preflight?.issues ?? []
  const contentIssues = issues.filter((i) => i.severity === 'error' && i.where.startsWith('settings:'))
  const serverIssues = issues.filter((i) => i.where === 'server' && i.severity === 'error')
  const errors = issues.filter((i) => i.severity === 'error')
  const changes = preflight?.changes ?? []

  const steps = [
    { done: true, title: 'Папка сайта выбрана', text: site.root, go: undefined },
    { done: site.depsInstalled, title: 'Зависимости сайта установлены', text: site.depsInstalled ? 'Готово' : 'Нужно один раз: Публикация → «Установить зависимости»', go: 'publish' as const },
    { done: contentIssues.length === 0, title: 'Контакты и реквизиты заполнены', text: contentIssues.length ? `Осталось исправить: ${contentIssues.length}` : 'Готово', go: 'content' as const },
    { done: serverIssues.length === 0, title: 'Сервер настроен и подтверждён', text: serverIssues.length ? serverIssues[0].message : 'Готово', go: 'settings' as const }
  ]
  const ready = steps.every((s) => s.done) && errors.length === 0

  return (
    <Page title="Обзор" subtitle="Состояние сайта и что нужно сделать дальше">
      <div className="stats">
        <div className="stat"><span>Опубликовано</span><strong>{site.publishedCount}</strong><small>товаров на сайте</small></div>
        <div className="stat"><span>Черновики</span><strong>{site.productCount - site.publishedCount}</strong><small>не видны на сайте</small></div>
        <div className="stat"><span>Не опубликовано</span><strong className={changes.length ? 'accent' : ''}>{changes.length}</strong><small>изменений с прошлой выкладки</small></div>
        <div className="stat"><span>Последняя выкладка</span><strong className="small">{preflight?.lastDeploy ? fmtDate(preflight.lastDeploy.at) : '—'}</strong><small>{preflight?.lastDeploy?.releaseId ?? 'ещё не выкладывали'}</small></div>
      </div>

      <div className={`banner ${errors.length ? 'bad' : changes.length ? 'warn' : 'ok'}`}>
        {errors.length ? <AlertTriangle size={22} /> : changes.length ? <Clock size={22} /> : <CheckCircle2 size={22} />}
        <div>
          <strong>{errors.length ? `Нужно исправить ошибок: ${errors.length}` : changes.length ? `Есть изменения, которых нет на сайте: ${changes.length}` : 'Всё актуально'}</strong>
          <p>{errors.length ? 'Пока они есть, выложить сайт нельзя. Подробности — на вкладке «Публикация».' : changes.length ? 'Проверьте список и выложите сайт.' : 'Сайт на сервере совпадает с тем, что в приложении.'}</p>
        </div>
        <button className="btn primary" onClick={() => app.go('publish')}><Rocket size={16} /> К публикации</button>
      </div>

      <div className="grid-2">
        {!ready && (
          <div className="card">
            <h2>Подготовка к первой выкладке</h2>
            <ul className="steps">
              {steps.map((s) => (
                <li key={s.title} className={s.done ? 'done' : ''}>
                  {s.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                  <div><strong>{s.title}</strong><small>{s.text}</small></div>
                  {!s.done && s.go && <button className="btn small" onClick={() => app.go(s.go!)}>Открыть <ArrowRight size={14} /></button>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="card">
          <h2>Последние действия</h2>
          {log.length === 0 ? <p className="muted-text">Пока ничего не менялось.</p> : (
            <ul className="activity">
              {log.map((e, i) => (
                <li key={i}><div><strong>{e.action}</strong><span>{e.target}{e.details ? ` · ${e.details}` : ''}</span></div><time>{fmtDate(e.at)}</time></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Page>
  )
}
