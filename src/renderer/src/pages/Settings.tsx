import { useCallback, useEffect, useState } from 'react'
import { Copy, FolderOpen, KeyRound, PlugZap, RotateCcw, Save, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { BackupInfo, ConnectionResult } from '../../../shared/types'
import { api, parseError } from '../api'
import { useApp } from '../appctx'
import { Field, Modal, Page, Pill, fmtBytes, fmtDate, useUi } from '../ui'

const BACKUP_LABEL = { products: 'Товары (на сайте)', pricelists: 'Прайсы (все группы товаров)', settings: 'Контент сайта' } as const

export default function Settings() {
  const app = useApp()
  const { run, toast, confirm, askSecret } = useUi()
  const { config, site } = app.state
  const [siteUrl, setSiteUrl] = useState(config.siteUrl)
  const [sv, setSv] = useState({ host: config.server.host, port: String(config.server.port), username: config.server.username, authType: config.server.authType, keyPath: config.server.keyPath, remoteBase: config.server.remoteBase, keepReleases: String(config.server.keepReleases) })
  const [pub, setPub] = useState<string | null>(null)
  const [conn, setConn] = useState<ConnectionResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [backups, setBackups] = useState<BackupInfo[]>([])

  const loadPub = useCallback(() => { api.getPublicKey().then(setPub).catch(() => setPub(null)) }, [])
  useEffect(() => { loadPub() }, [loadPub, config.server.keyPath])
  useEffect(() => { api.listBackups().then(setBackups).catch(() => setBackups([])) }, [])

  const dirty = siteUrl !== config.siteUrl || sv.host !== config.server.host || sv.port !== String(config.server.port) || sv.username !== config.server.username
    || sv.authType !== config.server.authType || sv.keyPath !== config.server.keyPath || sv.remoteBase !== config.server.remoteBase || sv.keepReleases !== String(config.server.keepReleases)

  const save = async (quiet = false) => {
    const s = await run(() => api.saveConfig({
      siteUrl, server: { host: sv.host, port: Number(sv.port), username: sv.username, authType: sv.authType, keyPath: sv.keyPath, remoteBase: sv.remoteBase, keepReleases: Number(sv.keepReleases) }
    }), quiet ? undefined : 'Настройки сохранены')
    if (s) { await app.refreshState(s); setConn(null) }
    return !!s
  }

  const test = async (opts: { secret?: string; trust?: string } = {}) => {
    if (dirty && !(await save(true))) return
    setTesting(true)
    try {
      const r = await api.testConnection(opts)
      if (!r.ok && !r.needsTrust && /пароль|пассфраз/i.test(r.message) && !opts.secret) {
        const s = await askSecret(sv.authType === 'password' ? 'password' : 'passphrase', r.message)
        if (s) { if (s.remember) await run(() => api.setSecret(sv.authType === 'password' ? 'password' : 'passphrase', s.value)); setTesting(false); return test({ ...opts, secret: s.value }) }
      }
      setConn(r)
      if (r.ok) await app.refreshState()
    } catch (e) {
      const pe = parseError(e)
      if (pe.code === 'NEED_SECRET') {
        const s = await askSecret('passphrase', pe.message)
        if (s) { if (s.remember) await run(() => api.setSecret('passphrase', s.value)); setTesting(false); return test({ ...opts, secret: s.value }) }
      } else setConn({ ok: false, message: pe.message })
    } finally { setTesting(false) }
  }

  const trust = async () => {
    if (!conn?.needsTrust) return
    const fp = conn.needsTrust.fingerprint
    setConn(null)
    await test({ trust: fp })
  }

  const genKey = async () => {
    const r = await run(() => api.generateKey())
    if (r) { setSv((s) => ({ ...s, keyPath: r.keyPath, authType: 'key' })); setPub(r.publicKey); await app.refreshState(); toast('success', 'Ключ создан. Добавьте публичный ключ на сервер (см. ниже).') }
  }
  const chooseKey = async () => { const p = await run(() => api.chooseKeyFile()); if (p) setSv((s) => ({ ...s, keyPath: p })) }
  const setPassword = async (kind: 'password' | 'passphrase') => {
    const s = await askSecret(kind, 'Значение будет сохранено в защищённом хранилище вашей системы.')
    if (s) { await run(() => api.setSecret(kind, s.value), 'Сохранено').then((st) => st && app.refreshState(st)) }
  }
  const clearSecret = async (kind: 'password' | 'passphrase') => { const st = await run(() => api.setSecret(kind, null), 'Удалено'); if (st) await app.refreshState(st) }
  const restore = async (b: BackupInfo) => {
    if (!(await confirm({ title: 'Восстановить копию?', text: `Файл «${BACKUP_LABEL[b.file].toLowerCase()}» вернётся к состоянию на ${fmtDate(b.at)}. Текущее состояние тоже сохранится в копиях.`, ok: 'Восстановить' }))) return
    await run(async () => { await api.restoreBackup(b.name); setBackups(await api.listBackups()); await app.refreshPreflight(); await app.refreshState() }, 'Восстановлено')
  }
  const chooseSite = async () => { const s = await run(() => api.chooseSite()); if (s) await app.refreshState(s) }
  const copy = async (text: string) => { await navigator.clipboard.writeText(text); toast('success', 'Скопировано') }

  return (
    <Page title="Настройки" actions={<button className="btn primary" disabled={!dirty} onClick={() => save()}><Save size={16} /> Сохранить</button>}>
      <div className="card">
        <h2>Сайт</h2>
        <div className="form-grid">
          <Field label="Папка сайта" hint={site ? `${site.productCount} товаров · зависимости ${site.depsInstalled ? 'установлены' : 'не установлены'}` : undefined}>
            <div className="input-row"><input readOnly value={config.siteRoot ?? ''} /><button className="btn" onClick={chooseSite}>Изменить…</button><button className="btn" onClick={() => api.openSiteFolder()}><FolderOpen size={16} /></button></div>
          </Field>
          <Field label="Адрес боевого сайта" hint="Для него собирается сайт и по нему проверяется результат выкладки"><input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://sorbentopt.ru" /></Field>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Сервер (VPS)</h2>
          {config.server.fingerprint ? <Pill kind="ok"><ShieldCheck size={12} /> Сервер подтверждён</Pill> : <Pill kind="warn"><ShieldAlert size={12} /> Не подтверждён</Pill>}</div>
        <div className="form-grid three">
          <Field label="Адрес сервера" hint="Домен или IP"><input value={sv.host} onChange={(e) => setSv({ ...sv, host: e.target.value })} placeholder="123.45.67.89" /></Field>
          <Field label="Порт SSH"><input value={sv.port} onChange={(e) => setSv({ ...sv, port: e.target.value })} /></Field>
          <Field label="Пользователь"><input value={sv.username} onChange={(e) => setSv({ ...sv, username: e.target.value })} /></Field>
          <Field label="Папка сайта на сервере"><input value={sv.remoteBase} onChange={(e) => setSv({ ...sv, remoteBase: e.target.value })} /></Field>
          <Field label="Хранить версий" hint="Остальные удаляются автоматически"><input type="number" min={2} max={30} value={sv.keepReleases} onChange={(e) => setSv({ ...sv, keepReleases: e.target.value })} /></Field>
          <Field label="Способ входа">
            <select value={sv.authType} onChange={(e) => setSv({ ...sv, authType: e.target.value as 'key' | 'password' })}><option value="key">SSH-ключ (рекомендуется)</option><option value="password">Пароль</option></select>
          </Field>
        </div>

        {sv.authType === 'key' ? (
          <div className="subcard">
            <div className="btn-row"><button className="btn" onClick={genKey}><KeyRound size={16} /> Создать SSH-ключ</button><button className="btn" onClick={chooseKey}>Выбрать свой файл ключа…</button>
              {config.hasPassphrase ? <button className="btn small" onClick={() => clearSecret('passphrase')}>Забыть пароль ключа</button> : <button className="btn small" onClick={() => setPassword('passphrase')}>Сохранить пароль ключа</button>}</div>
            <small className="muted-text">Файл ключа: <code>{sv.keyPath || 'не выбран'}</code></small>
            {pub && <>
              <p className="muted-text" style={{ marginBottom: 6 }}>Добавьте эту строку на сервере в файл <code>/home/{sv.username || 'deploy'}/.ssh/authorized_keys</code>:</p>
              <div className="keybox"><code>{pub}</code><button className="icon-btn" title="Копировать" onClick={() => copy(pub)}><Copy size={16} /></button></div>
            </>}
          </div>
        ) : (
          <div className="subcard"><div className="btn-row">
            {config.hasPassword ? <><Pill kind="ok">Пароль сохранён</Pill><button className="btn small" onClick={() => clearSecret('password')}>Удалить</button></> : <><button className="btn" onClick={() => setPassword('password')} disabled={!config.secureStorage}>Сохранить пароль</button><small className="muted-text">{config.secureStorage ? 'Или он будет запрашиваться при каждой выкладке.' : 'Хранилище недоступно — пароль будет запрашиваться при каждой выкладке.'}</small></>}
          </div></div>
        )}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={testing || !sv.host} onClick={() => test()}><PlugZap size={16} /> {testing ? 'Проверяем…' : 'Проверить подключение'}</button>
        </div>
        {conn && !conn.needsTrust && (
          <div className={`callout ${conn.ok ? 'ok' : 'bad'}`}><div><strong>{conn.message}</strong>{conn.details?.map((d, i) => <div key={i}>{d}</div>)}</div></div>
        )}
      </div>

      <div className="card">
        <h2>Резервные копии</h2>
        <p className="muted-text">Перед каждым изменением товаров и контента приложение сохраняет копию файла (последние 100). Эти копии нужны, чтобы вернуть случайно удалённое.</p>
        {backups.length === 0 ? <p className="muted-text">Копий пока нет.</p> : (
          <table className="table compact"><tbody>
            {backups.slice(0, 12).map((b) => (
              <tr key={b.name}><td>{BACKUP_LABEL[b.file]}</td><td>{fmtDate(b.at)}</td><td className="muted-text">{fmtBytes(b.size)}</td>
                <td className="right"><button className="btn small" onClick={() => restore(b)}><RotateCcw size={14} /> Восстановить</button></td></tr>
            ))}
          </tbody></table>
        )}
      </div>

      {conn?.needsTrust && (
        <Modal title={conn.needsTrust.changed ? 'Отпечаток сервера изменился!' : 'Подтвердите сервер'} width={560} onClose={() => setConn(null)}
          footer={<><button className="btn" onClick={() => setConn(null)}>Отмена</button><button className={`btn ${conn.needsTrust.changed ? 'danger' : 'primary'}`} onClick={trust}>{conn.needsTrust.changed ? 'Я знаю причину, доверять новому' : 'Да, это мой сервер'}</button></>}>
          {conn.needsTrust.changed
            ? <div className="callout bad"><ShieldAlert size={18} /><div>Сервер <b>{sv.host}</b> представился иначе, чем раньше. Это бывает после переустановки сервера — но может означать подмену. Если вы сервер не переустанавливали, не продолжайте.</div></div>
            : <p className="muted-text" style={{ marginTop: 0 }}>Вы подключаетесь к серверу <b>{sv.host}</b> впервые. Сверьте отпечаток с тем, что показывает сервер (команда <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>). Так приложение убедится, что подключается именно к вашему серверу, а не к чужому.</p>}
          <div className="keybox"><code>{conn.needsTrust.fingerprint}</code><button className="icon-btn" onClick={() => copy(conn.needsTrust!.fingerprint)}><Copy size={16} /></button></div>
        </Modal>
      )}
    </Page>
  )
}
