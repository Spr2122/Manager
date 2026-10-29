import { FolderOpen, Info } from 'lucide-react'
import type { AppState } from '../../../shared/types'
import { api } from '../api'
import { useUi } from '../ui'

export default function Welcome({ state, onChange }: { state: AppState; onChange: (s?: AppState) => Promise<void> }) {
  const { run } = useUi()
  const choose = async () => {
    const s = await run(() => api.chooseSite())
    if (s) await onChange(s)
  }
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="brand-mark big">С</div>
        <h1>SorbentOpt Manager</h1>
        <p>Приложение для управления сайтом: товары и цены, контакты и реквизиты, проверка, сборка и выкладка на сервер.</p>
        {state.siteError ? (
          <div className="callout bad"><Info size={18} /><div><strong>Эта папка не подходит</strong><br />{state.siteError}</div></div>
        ) : (
          <div className="callout"><Info size={18} /><div>Выберите папку, где лежит сайт (в ней есть <code>package.json</code> и <code>src/data/products.json</code>).</div></div>
        )}
        <button className="btn primary big" onClick={choose}><FolderOpen size={18} /> {state.siteError ? 'Выбрать другую папку' : 'Выбрать папку сайта'}</button>
        {state.config.siteRoot && <small className="muted-text path">Сейчас: {state.config.siteRoot}</small>}
      </div>
    </div>
  )
}
