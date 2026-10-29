import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import type { Issue } from '../../shared/types'
import { SETTINGS_FIELD_LABELS } from '../../shared/validate'
import { parseError } from './api'

// ───────── уведомления и общий контекст ─────────

type ToastKind = 'success' | 'error' | 'info'
interface Toast { id: number; kind: ToastKind; text: string }
interface SecretAsk { kind: 'passphrase' | 'password'; note?: string; done: (v: { value: string; remember: boolean } | null) => void }

export interface UiCtx {
  toast: (kind: ToastKind, text: string) => void
  /** Выполняет действие, показывает ошибку тостом. Возвращает undefined при ошибке. */
  run: <T>(fn: () => Promise<T>, okText?: string) => Promise<T | undefined>
  askSecret: (kind: 'passphrase' | 'password', note?: string) => Promise<{ value: string; remember: boolean } | null>
  confirm: (o: { title: string; text: string; ok: string; danger?: boolean }) => Promise<boolean>
}
const Ctx = createContext<UiCtx>(null as unknown as UiCtx)
export const useUi = () => useContext(Ctx)

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [secretAsk, setSecretAsk] = useState<SecretAsk | null>(null)
  const [confirmAsk, setConfirmAsk] = useState<{ title: string; text: string; ok: string; danger?: boolean; done: (v: boolean) => void } | null>(null)
  const seq = useRef(0)

  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4000)
  }, [])

  const run = useCallback(async <T,>(fn: () => Promise<T>, okText?: string) => {
    try {
      const r = await fn()
      if (okText) toast('success', okText)
      return r
    } catch (e) {
      toast('error', parseError(e).message)
      return undefined
    }
  }, [toast])

  const askSecret = useCallback<UiCtx['askSecret']>((kind, note) => new Promise((done) => setSecretAsk({ kind, note, done })), [])
  const confirm = useCallback<UiCtx['confirm']>((o) => new Promise((done) => setConfirmAsk({ ...o, done })), [])
  const value = useMemo(() => ({ toast, run, askSecret, confirm }), [toast, run, askSecret, confirm])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' ? <CheckCircle2 size={17} /> : t.kind === 'error' ? <XCircle size={17} /> : <Info size={17} />}
            <span>{t.text}</span>
            <button aria-label="Закрыть" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X size={14} /></button>
          </div>
        ))}
      </div>
      {secretAsk && <SecretModal ask={secretAsk} onClose={() => setSecretAsk(null)} />}
      {confirmAsk && (
        <Modal title={confirmAsk.title} width={440} onClose={() => { confirmAsk.done(false); setConfirmAsk(null) }}
          footer={<>
            <button className="btn" onClick={() => { confirmAsk.done(false); setConfirmAsk(null) }}>Отмена</button>
            <button className={`btn ${confirmAsk.danger ? 'danger' : 'primary'}`} onClick={() => { confirmAsk.done(true); setConfirmAsk(null) }} autoFocus>{confirmAsk.ok}</button>
          </>}>
          <p className="muted-text" style={{ margin: 0, lineHeight: 1.6 }}>{confirmAsk.text}</p>
        </Modal>
      )}
    </Ctx.Provider>
  )
}

function SecretModal({ ask, onClose }: { ask: SecretAsk; onClose: () => void }) {
  const [value, setValue] = useState('')
  const [remember, setRemember] = useState(false)
  const submit = () => { if (!value) return; ask.done({ value, remember }); onClose() }
  const cancel = () => { ask.done(null); onClose() }
  return (
    <Modal title={ask.kind === 'password' ? 'Пароль для входа на сервер' : 'Пароль от SSH-ключа'} width={460} onClose={cancel}
      footer={<><button className="btn" onClick={cancel}>Отмена</button><button className="btn primary" onClick={submit} disabled={!value}>Продолжить</button></>}>
      {ask.note && <p className="muted-text" style={{ marginTop: 0 }}>{ask.note}</p>}
      <label className="field">
        <span>{ask.kind === 'password' ? 'Пароль' : 'Пассфраза ключа'}</span>
        <input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </label>
      <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Запомнить в защищённом хранилище этого компьютера</label>
    </Modal>
  )
}

// ───────── базовые элементы ─────────

export function Modal({ title, children, footer, onClose, width = 760 }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width: `min(${width}px, 100%)` }}>
        <header><h2>{title}</h2><button className="icon-btn" aria-label="Закрыть" onClick={onClose}><X size={18} /></button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}

export function Field({ label, hint, error, children, wide }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' wide' : ''}${error ? ' invalid' : ''}`}>
      <span>{label}</span>
      {children}
      {error ? <small className="err">{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  )
}

export function Counter({ value, max, min }: { value: string; max: number; min?: number }) {
  const n = value.length
  const bad = n > max || (min !== undefined && n > 0 && n < min)
  return <span className={`counter${bad ? ' bad' : ''}`}>{n} / {max}</span>
}

export function Pill({ kind, children }: { kind: 'published' | 'draft' | 'ok' | 'warn' | 'bad' | 'muted'; children: ReactNode }) {
  return <span className={`pill ${kind}`}>{children}</span>
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{action}</div>
}

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <div className="page-head"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="head-actions">{actions}</div>}</div>
      {children}
    </section>
  )
}

export function IssueList({ issues, onGo }: { issues: Issue[]; onGo?: (where: string) => void }) {
  if (!issues.length) return null
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  return (
    <ul className="issues">
      {sorted.map((i, k) => (
        <li key={k} className={i.severity}>
          {i.severity === 'error' ? <XCircle size={16} /> : <AlertTriangle size={16} />}
          <span>{i.where.startsWith('settings:') && SETTINGS_FIELD_LABELS[i.where.slice(9)] ? <b>{SETTINGS_FIELD_LABELS[i.where.slice(9)]}: </b> : null}{i.message}</span>
          {onGo && /^(product|settings|server)/.test(i.where) && <button className="link" onClick={() => onGo(i.where)}>Исправить</button>}
        </li>
      ))}
    </ul>
  )
}

/** Консоль журнала задачи: автопрокрутка вниз. */
export function LogConsole({ lines, empty }: { lines: string[]; empty?: string }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight }, [lines])
  return <pre className="console" ref={ref}>{lines.length ? lines.join('\n') : empty ?? 'Здесь появится журнал выполнения.'}</pre>
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })
export const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`)

const imgCache = new Map<string, string | null>()
/** Загрузка миниатюры с кэшем (изображения лежат в папке сайта, наружу интерфейс не ходит). */
export function useImage(path: string, bump = 0): string | null {
  const [src, setSrc] = useState<string | null>(imgCache.get(path + bump) ?? null)
  useEffect(() => {
    let live = true
    const key = path + bump
    if (!path) { setSrc(null); return }
    if (imgCache.has(key)) { setSrc(imgCache.get(key) ?? null); return }
    import('./api').then(({ api }) => api.getImage(path).then((d) => { imgCache.set(key, d); if (live) setSrc(d) }).catch(() => live && setSrc(null)))
    return () => { live = false }
  }, [path, bump])
  return src
}
