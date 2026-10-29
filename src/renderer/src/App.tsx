import { useCallback, useEffect, useState } from 'react'
import { Boxes, FileText, Gauge, Globe, Rocket, Settings as Cog } from 'lucide-react'
import type { AppState, PreflightResult } from '../../shared/types'
import { api, parseError } from './api'
import { App as AppContext, type Focus, type PageId } from './appctx'
import { UiProvider, useUi } from './ui'
import Welcome from './pages/Welcome'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Content from './pages/Content'
import Publish from './pages/Publish'
import Settings from './pages/Settings'

const NAV: Array<{ id: PageId; label: string; icon: typeof Gauge }> = [
  { id: 'dashboard', label: 'Обзор', icon: Gauge },
  { id: 'products', label: 'Товары', icon: Boxes },
  { id: 'content', label: 'Контент сайта', icon: FileText },
  { id: 'publish', label: 'Публикация', icon: Rocket },
  { id: 'settings', label: 'Настройки', icon: Cog }
]

function Shell() {
  const { toast } = useUi()
  const [state, setState] = useState<AppState | null>(null)
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const [focus, setFocus] = useState<Focus>({ page: 'dashboard' })

  const refreshPreflight = useCallback(async () => {
    try { setPreflight(await api.preflight()) } catch { setPreflight(null) }
  }, [])

  const refreshState = useCallback(async (s?: AppState) => {
    try {
      const next = s ?? (await api.getState())
      setState(next)
      if (next.site) await refreshPreflight(); else setPreflight(null)
    } catch (e) { toast('error', parseError(e).message) }
  }, [refreshPreflight, toast])

  useEffect(() => { void refreshState() }, [refreshState])

  if (!state) return <div className="splash">Загрузка…</div>
  if (!state.site) return <Welcome state={state} onChange={refreshState} />

  const go = (page: PageId, f: Partial<Focus> = {}) => setFocus({ page, ...f })
  const errors = preflight?.issues.filter((i) => i.severity === 'error').length ?? 0
  const changes = preflight?.changes.length ?? 0
  const badge = (id: PageId) => (id === 'publish' ? (errors ? { n: errors, bad: true } : changes ? { n: changes, bad: false } : null) : null)

  return (
    <AppContext.Provider value={{ state, preflight, refreshState, refreshPreflight, go, focus, clearFocus: () => setFocus((f) => ({ page: f.page })) }}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand"><div className="brand-mark">С</div><div><strong>СорбентОпт</strong><small>Управление сайтом</small></div></div>
          <nav>
            {NAV.map(({ id, label, icon: Icon }) => {
              const b = badge(id)
              return (
                <button key={id} className={`nav-item${focus.page === id ? ' active' : ''}`} onClick={() => go(id)}>
                  <Icon size={18} /><span>{label}</span>{b && <em className={b.bad ? 'bad' : ''}>{b.n}</em>}
                </button>
              )
            })}
          </nav>
          <div className="sidebar-foot">
            <div className={`site-state${errors ? ' bad' : changes ? ' warn' : ''}`}>
              <i />
              <div>
                <strong>{errors ? 'Есть ошибки' : changes ? `Не опубликовано: ${changes}` : preflight?.lastDeploy ? 'Сайт актуален' : 'Ещё не публиковалось'}</strong>
                <small>{state.config.siteUrl.replace(/^https?:\/\//, '')}</small>
              </div>
            </div>
            <button className="nav-item small" onClick={() => void api.openSiteUrl()}><Globe size={16} /><span>Открыть сайт</span></button>
            <div className="version">Версия {state.version}</div>
          </div>
        </aside>
        <main className="main">
          {focus.page === 'dashboard' && <Dashboard />}
          {focus.page === 'products' && <Products />}
          {focus.page === 'content' && <Content />}
          {focus.page === 'publish' && <Publish />}
          {focus.page === 'settings' && <Settings />}
        </main>
      </div>
    </AppContext.Provider>
  )
}

export default function Root() {
  return <UiProvider><Shell /></UiProvider>
}
