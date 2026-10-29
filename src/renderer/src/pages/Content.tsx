import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CalendarCheck, ChevronDown, ChevronRight, Eye, EyeOff, RotateCcw, Save, Search, Wand2 } from 'lucide-react'
import type { ContactId, SiteSettings, SiteTexts } from '../../../shared/types'
import { validateSettings } from '../../../shared/validate'
import { TEXT_FIELDS, canonicalSettings, defaultTexts, type TextField } from '../../../shared/texts'
import { PAGE_TEXT_FIELDS, PAGE_TEXT_GROUPS } from '../../../shared/pageTextFields'
import { api } from '../api'
import { useApp } from '../appctx'
import { Counter, Field, Page, useUi } from '../ui'

const today = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const fmtPhone = (e: string) => { const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e); return m ? `+7 (${m[1]}) ${m[2]}-${m[3]}-${m[4]}` : e }

/** Один способ связи: переключатель «показывать на сайте» и его поля. Скрытый контакт хранит значения, но на сайте не отображается. */
function ContactRow({ label, hidden, onToggle, children }: { label: string; hidden: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={`contact-row${hidden ? ' off' : ''}`}>
      <div className="contact-head">
        <strong>{label}</strong>
        <button type="button" className={`vis-toggle${hidden ? '' : ' on'}`} role="switch" aria-checked={!hidden} onClick={onToggle}
          title={hidden ? 'Показать на сайте' : 'Скрыть с сайта'}>
          {hidden ? <EyeOff size={15} /> : <Eye size={15} />}{hidden ? 'Скрыт на сайте' : 'Показывается на сайте'}
        </button>
      </div>
      <div className="contact-fields">{children}</div>
    </div>
  )
}

export default function Content() {
  const app = useApp()
  const { run } = useUi()
  const [orig, setOrig] = useState<SiteSettings | null>(null)
  const [s, setS] = useState<SiteSettings | null>(null)
  const [pageTextSearch, setPageTextSearch] = useState('')
  const [openPageGroups, setOpenPageGroups] = useState<string[]>([])
  const refs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => { run(() => api.getSettings()).then((v) => { if (v) { setOrig(v); setS(v) } }) }, [run])
  useEffect(() => {
    const f = app.focus.field
    if (f && s) { refs.current[f]?.scrollIntoView({ block: 'center' }); (refs.current[f] as HTMLInputElement | null)?.focus(); app.clearFocus() }
  }, [app, s])

  const issues = useMemo(() => (s ? validateSettings(s) : []), [s])
  const err = (k: string) => issues.find((i) => i.where === `settings:${k}` && i.severity === 'error')?.message
  const warn = (k: string) => issues.find((i) => i.where === `settings:${k}` && i.severity === 'warning')?.message
  const defaults = useMemo(() => (s ? defaultTexts(s) : null), [s])
  if (!s || !orig || !defaults) return <Page title="Контент сайта"><p className="muted-text">Загрузка…</p></Page>

  const dirty = JSON.stringify(canonicalSettings(s)) !== JSON.stringify(canonicalSettings(orig))
  const hidden = new Set<ContactId>(s.hiddenContacts ?? [])
  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => setS({ ...s, [k]: v })
  const toggleContact = (id: ContactId) => { const n = new Set(hidden); if (n.has(id)) n.delete(id); else n.add(id); set('hiddenContacts', [...n]) }
  const text = (k: keyof SiteSettings, label: string, o: { hint?: string; placeholder?: string; wide?: boolean } = {}) => (
    <Field label={label} error={err(k)} hint={warn(k) ?? o.hint} wide={o.wide}>
      <input ref={(el) => { refs.current[k] = el }} value={String(s[k] ?? '')} placeholder={o.placeholder} onChange={(e) => set(k, e.target.value as never)} />
    </Field>
  )
  const num = (k: 'vatPercent' | 'volumeFromTons' | 'volumeToTons', label: string) => (
    <Field label={label} error={err(k)}><input ref={(el) => { refs.current[k] = el }} type="number" value={s[k]} onChange={(e) => set(k, Number(e.target.value))} /></Field>
  )
  const setText = (k: keyof SiteTexts, v: string) => set('texts', { ...s.texts, [k]: v })
  const setPageText = (k: string, v: string) => set('pageTexts', { ...(s.pageTexts ?? {}), [k]: v })
  const save = async () => {
    const saved = await run(() => api.saveSettings(s), 'Сохранено')
    if (saved) { setOrig(saved); setS(saved); await app.refreshPreflight() }
  }

  const textField = (f: TextField) => {
    const value = s.texts?.[f.key] ?? ''
    const def = defaults[f.key]
    const custom = value.trim() !== ''
    const Tag = f.multiline ? 'textarea' : 'input'
    return (
      <Field key={f.key} label={f.label} wide error={err(f.key)}
        hint={<>
          {custom ? 'На сайте будет ваш текст.' : def ? 'Пусто — на сайте стандартный текст (показан серым).' : 'Пусто — на сайте текст по умолчанию из шаблона сайта.'}
          {f.hint ? ` ${f.hint}.` : ''}
        </>}>
        <Tag ref={(el: HTMLInputElement & HTMLTextAreaElement | null) => { refs.current[f.key] = el }} value={value} placeholder={def || 'Текст из шаблона сайта'}
          {...(f.multiline ? { rows: f.key === 'footerRequisites' ? 4 : 3 } : {})}
          onChange={(e) => setText(f.key, e.target.value)} />
        <div className="text-tools">
          {def && !custom && <button type="button" className="btn small" onClick={() => setText(f.key, def)}><Wand2 size={13} /> Взять стандартный и править</button>}
          {custom && <button type="button" className="btn small" onClick={() => setText(f.key, '')}><RotateCcw size={13} /> Вернуть стандартный</button>}
          <span className="grow" />{custom && <Counter value={value} max={f.max} />}
        </div>
      </Field>
    )
  }

  return (
    <Page title="Контент сайта" subtitle="Контакты, тексты основных разделов страниц, шапка и подвал, реквизиты, прайс-лист."
      actions={<>{dirty && <button className="btn" onClick={() => setS(orig)}>Отменить</button>}<button className="btn primary" disabled={!dirty} onClick={save}><Save size={16} /> Сохранить</button></>}>
      <div className="card">
        <h2>Контакты</h2>
        <p className="muted-text card-note">Переключатель справа убирает контакт с сайта (шапка, подвал, окно «Как удобно связаться?»). Значения при этом сохраняются — контакт можно вернуть в любой момент.</p>
        <div className="contact-list">
          <ContactRow label="Телефон" hidden={hidden.has('phone')} onToggle={() => toggleContact('phone')}>
            {text('phone', 'Номер', { placeholder: '+79261234567', hint: `На сайте: ${fmtPhone(s.phone)}` })}
          </ContactRow>
          <ContactRow label="WhatsApp" hidden={hidden.has('whatsapp')} onToggle={() => toggleContact('whatsapp')}>
            {text('whatsapp', 'Номер (только цифры)', { placeholder: '79261234567', hint: 'Пусто — берётся номер телефона' })}
          </ContactRow>
          <ContactRow label="Telegram" hidden={hidden.has('telegram')} onToggle={() => toggleContact('telegram')}>
            {text('telegram', 'Имя (без @)', { placeholder: 'sorbent_opt' })}
          </ContactRow>
          <ContactRow label="MAX" hidden={hidden.has('max')} onToggle={() => toggleContact('max')}>
            {text('maxUrl', 'Ссылка', { placeholder: 'https://max.ru/u/…', hint: 'Пусто — кнопка MAX тоже скрывается' })}
            {text('maxHandle', 'Как показывать', { placeholder: '@sorbent_opt' })}
          </ContactRow>
          <ContactRow label="Email" hidden={hidden.has('email')} onToggle={() => toggleContact('email')}>
            {text('email', 'Адрес')}
          </ContactRow>
        </div>
        {err('hiddenContacts') && <div className="inline-error" style={{ marginTop: 10 }}>{err('hiddenContacts')}</div>}
      </div>

      <div className="card">
        <h2>Шапка сайта</h2>
        <p className="muted-text card-note">Можно полностью заменить тексты. Поле оставлено пустым — используется стандартный текст сайта.</p>
        <div className="form-grid one">{TEXT_FIELDS.filter((f) => f.group === 'header').map(textField)}</div>
      </div>
      <div className="card">
        <h2>Подвал сайта</h2>
        <p className="muted-text card-note">Контакты в подвале управляются переключателями выше. Здесь — тексты. Перенос строки в многострочных полях сохраняется на сайте.</p>
        <div className="form-grid one">{TEXT_FIELDS.filter((f) => f.group === 'footer').map(textField)}</div>
      </div>

      <div className="card">
        <h2>Тексты разделов страниц</h2>
        <p className="muted-text card-note">Здесь можно менять заголовки и описания основных разделов сайта. Изменения вступят в силу после сохранения, предпросмотра и выкладки сайта. Пустое поле возвращает стандартный текст. Описания конкретных товаров редактируются во вкладке «Товары».</p>
        <div className="page-text-tools">
          <label className="page-text-search"><Search size={16} /><input value={pageTextSearch} onChange={(e) => setPageTextSearch(e.target.value)} placeholder="Найти текст: например, доставка, кнопка, FAQ…" /></label>
          <div className="page-text-actions">
            <button type="button" className="btn small" onClick={() => setOpenPageGroups(PAGE_TEXT_GROUPS.map((g) => g.id))}>Развернуть все</button>
            <button type="button" className="btn small" onClick={() => setOpenPageGroups([])}>Свернуть все</button>
          </div>
        </div>
        <p className="muted-text card-note">Разделы сгруппированы по страницам. Откройте нужную группу или воспользуйтесь поиском — при поиске подходящие группы раскроются автоматически.</p>
        {PAGE_TEXT_GROUPS.map((group) => {
          const allFields = PAGE_TEXT_FIELDS.filter((f) => f.group === group.id)
          const q = pageTextSearch.trim().toLocaleLowerCase('ru-RU')
          const fields = q ? allFields.filter((f) => `${f.label} ${f.key} ${f.fallback}`.toLocaleLowerCase('ru-RU').includes(q)) : allFields
          if (q && fields.length === 0) return null
          const isOpen = q.length > 0 || openPageGroups.includes(group.id)
          const customCount = fields.filter((f) => (s.pageTexts?.[f.key] ?? '').trim() !== '').length
          return <section className={`page-text-group${isOpen ? ' expanded' : ''}`} key={group.id}>
            <button type="button" className="page-text-group-toggle" aria-expanded={isOpen} onClick={() => setOpenPageGroups((prev) => prev.includes(group.id) ? prev.filter((id) => id !== group.id) : [...prev, group.id])}>
              <span className="page-text-group-chevron">{isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
              <span className="page-text-group-title">{group.label}<small>{fields.length} полей{customCount ? ` · изменено: ${customCount}` : ''}</small></span>
              <span className="page-text-group-state">{isOpen ? 'Свернуть' : 'Открыть'}</span>
            </button>
            {isOpen && <div className="page-text-group-content"><div className="form-grid one">
              {fields.map((f) => {
                const value = s.pageTexts?.[f.key] ?? ''
                const custom = value.trim() !== ''
                return <Field key={f.key} label={f.label} wide hint={custom ? 'На сайте будет ваш текст.' : 'Пусто — используется стандартный текст сайта.'}>
                  {f.multiline
                    ? <textarea ref={(el) => { refs.current[`page:${f.key}`] = el }} rows={3} value={value} placeholder={f.fallback} onChange={(e) => setPageText(f.key, e.target.value)} />
                    : <input ref={(el) => { refs.current[`page:${f.key}`] = el }} value={value} placeholder={f.fallback} onChange={(e) => setPageText(f.key, e.target.value)} />}
                  <div className="text-tools">
                    {!custom && <button type="button" className="btn small" onClick={() => setPageText(f.key, f.fallback)}><Wand2 size={13} /> Взять стандартный и править</button>}
                    {custom && <button type="button" className="btn small" onClick={() => setPageText(f.key, '')}><RotateCcw size={13} /> Вернуть стандартный</button>}
                    <span className="grow" />{custom && <Counter value={value} max={2000} />}
                  </div>
                </Field>
              })}
            </div></div>}
          </section>
        })}
        {pageTextSearch.trim() && !PAGE_TEXT_FIELDS.some((f) => `${f.label} ${f.key} ${f.fallback}`.toLocaleLowerCase('ru-RU').includes(pageTextSearch.trim().toLocaleLowerCase('ru-RU'))) && <p className="muted-text">Ничего не найдено. Попробуйте другое слово.</p>}
      </div>

      <div className="card">
        <h2>Производитель</h2>
        <div className="form-grid">{text('manufacturerName', 'Название')}{text('manufacturerCity', 'Город')}</div>
      </div>
      <div className="card">
        <h2>Владелец сайта (реквизиты в подвале)</h2>
        <div className="form-grid three">{text('ownerName', 'ФИО / наименование', { placeholder: 'ИП Иванов И. И.' })}{text('ownerInn', 'ИНН')}{text('ownerOgrnip', 'ОГРНИП')}</div>
      </div>
      <div className="card">
        <h2>Прайс-лист</h2>
        <div className="form-grid three">
          <Field label="Дата прайса" error={err('priceListDate')} hint={warn('priceListDate') ?? 'Показывается как «Актуален на …». При размещении прайса на сайте (Товары) подставляется из него'}>
            <div className="input-row">
              <input ref={(el) => { refs.current.priceListDate = el }} type="date" value={s.priceListDate} onChange={(e) => set('priceListDate', e.target.value)} />
              <button type="button" className="btn small" onClick={() => set('priceListDate', today())}><CalendarCheck size={14} /> Сегодня</button>
            </div>
          </Field>
          {num('vatPercent', 'НДС, %')}
          <Field label="Цена действительна до (необязательно)" error={err('priceValidUntil')} hint="Для поисковиков; пусто — не указывать">
            <input type="date" value={s.priceValidUntil} onChange={(e) => set('priceValidUntil', e.target.value)} />
          </Field>
          {num('volumeFromTons', 'Объём поставки от, т')}{num('volumeToTons', 'Объём поставки до, т')}
        </div>
        <label className="check download-toggle">
          <input type="checkbox" checked={s.priceDownload !== false} onChange={(e) => set('priceDownload', e.target.checked)} />
          <span><strong>Кнопка «Скачать прайс-лист» на сайте</strong><br /><small className="muted-text">Excel-файл собирается вместе с сайтом из товаров, цен и даты выбранного прайса; контакты в нём — только показываемые на сайте.</small></span>
        </label>
        <p className="muted-text preview-note">Надпись на сайте: «Цены указаны с учётом НДС {s.vatPercent}%, для объёма поставки от {s.volumeFromTons} до {s.volumeToTons} тонн.»</p>
      </div>
    </Page>
  )
}
