import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ImagePlus, Images, Lock, Unlock } from 'lucide-react'
import type { PriceListsFile, ProductRecord, ProductsFile, SiteSettings } from '../../../shared/types'
import { formatPrice, parsePriceInput } from '../../../shared/price'
import { slugify, SLUG_RE } from '../../../shared/slug'
import { validateProducts } from '../../../shared/validate'
import { api } from '../api'
import { useApp } from '../appctx'
import { Counter, Field, IssueList, Modal, useImage, useUi } from '../ui'

function GalleryThumb({ path, active, onPick }: { path: string; active: boolean; onPick: () => void }) {
  const src = useImage(path)
  return <button type="button" className={`gal${active ? ' active' : ''}`} onClick={onPick} title={path}>{src ? <img src={src} alt="" /> : null}</button>
}

export default function ProductEditor({ product, file, listId, isActive, onClose, onSaved }: {
  product: ProductRecord | null; file: ProductsFile; listId: string; isActive: boolean; onClose: () => void; onSaved: (f: PriceListsFile) => void | Promise<void>
}) {
  const app = useApp()
  const { run, toast } = useUi()
  const isNew = !product
  const [f, setF] = useState(() => ({
    name: product?.name ?? '', shortName: product?.shortName ?? '', slug: product?.slug ?? '', status: product?.status ?? 'draft',
    fraction: product?.fraction ?? '', packaging: product?.packaging ?? '', minimum: product?.minimum ?? 'От 10 тонн',
    priceText: product?.price != null ? String(product.price).replace('.', ',') : '', onRequest: product ? product.price === null : false,
    priceUnit: product?.priceUnit ?? '₽/т', image: product?.image ?? '', description: product?.description ?? '',
    applications: (product?.applications ?? []).join('\n'), seoTitle: product?.seoTitle ?? '', seoDescription: product?.seoDescription ?? ''
  }))
  const [slugTouched, setSlugTouched] = useState(!isNew)
  const [shortTouched, setShortTouched] = useState(false)
  const [slugUnlocked, setSlugUnlocked] = useState(isNew)
  const [images, setImages] = useState<string[]>([])
  const [gallery, setGallery] = useState(false)
  const [settings, setSettings] = useState<SiteSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [imgBump, setImgBump] = useState(0)

  useEffect(() => { api.listImages().then(setImages).catch(() => undefined); api.getSettings().then(setSettings).catch(() => undefined) }, [])
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))

  const onName = (v: string) => setF((s) => ({
    ...s, name: v,
    slug: slugTouched ? s.slug : slugify(v),
    shortName: shortTouched ? s.shortName : v
  }))

  const price = f.onRequest ? null : parsePriceInput(f.priceText)
  const priceError = price === 'invalid' ? 'Введите число, например 12000 или 12 500,50' : undefined
  const slugError = f.slug && !SLUG_RE.test(f.slug) ? 'Только латинские буквы, цифры и дефисы' : undefined
  const applications = f.applications.split('\n').map((s) => s.trim()).filter(Boolean)

  const candidate: ProductRecord = useMemo(() => ({
    id: product?.id ?? 'p_new', oldSlugs: product?.oldSlugs ?? [], status: f.status, slug: f.slug, name: f.name, shortName: f.shortName,
    fraction: f.fraction, packaging: f.packaging, price: typeof price === 'number' || price === null ? price : null, priceUnit: f.priceUnit,
    minimum: f.minimum, image: f.image, description: f.description, applications, seoTitle: f.seoTitle, seoDescription: f.seoDescription
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [f, product, price])

  // тот же набор правил, что и при выкладке, но только по этому товару
  const issues = useMemo(() => {
    const list = file.products.some((p) => p.id === candidate.id) ? file.products.map((p) => (p.id === candidate.id ? candidate : p)) : [...file.products, candidate]
    const known = new Set(images)
    return validateProducts({ schemaVersion: 2, products: list }, { imageExists: (p) => known.has(p) })
      .filter((i) => i.where === `product:${candidate.id}`)
      .map((i) => ({ ...i, message: i.message.replace(/^«[^»]*»: /, '') }))
  }, [file, candidate, images])
  const errors = issues.filter((i) => i.severity === 'error')

  const pickFile = async () => {
    const r = await run(() => api.pickImage())
    if (!r) return
    set('image', r.path); setImgBump((n) => n + 1)
    setImages(await api.listImages())
    if (r.warning) toast('info', r.warning)
  }

  const autoTitle = `${f.name || 'Название'} — цена и поставка | СорбентОпт`
  const autoDesc = `${f.name || 'Название'}. Фракция ${f.fraction || '…'}, упаковка ${f.packaging || '…'}. Оптовая поставка от ${settings?.volumeFromTons ?? 10} тонн по России. Цена ${formatPrice(candidate.price, f.priceUnit)}.`
  const imgSrc = useImage(f.image, imgBump)

  const save = async (publish?: boolean) => {
    if (priceError || slugError) return
    setBusy(true)
    const res = await run(() => api.saveProduct({
      id: product?.id, status: publish === undefined ? f.status : publish ? 'published' : 'draft', slug: f.slug, name: f.name, shortName: f.shortName.trim() || f.name,
      fraction: f.fraction, packaging: f.packaging, minimum: f.minimum, price: candidate.price, priceUnit: f.priceUnit,
      image: f.image, description: f.description, applications, seoTitle: f.seoTitle, seoDescription: f.seoDescription
    }, listId))
    setBusy(false)
    if (!res) return
    toast('success', res.slugChanged ? 'Сохранено. Старый адрес будет перенаправлять на новый.' : 'Товар сохранён')
    await onSaved(res.file)
    void app.refreshPreflight()
  }

  return (
    <Modal title={isNew ? 'Новый товар' : 'Редактирование товара'} width={900} onClose={onClose}
      footer={<>
        <span className="foot-note">{f.status === 'published' ? (errors.length ? `Для публикации исправьте: ${errors.length}` : 'Готов к публикации') : 'Черновик — на сайте не виден'}</span>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn" disabled={busy || !f.name.trim() || !!priceError || !!slugError} onClick={() => save(false)}>Сохранить как черновик</button>
        <button className="btn primary" disabled={busy || !f.name.trim() || !!priceError || !!slugError || errors.length > 0} onClick={() => save(true)} title={errors.length ? 'Сначала исправьте ошибки' : undefined}>{isActive ? 'Сохранить и опубликовать товар' : 'Сохранить как опубликованный товар в прайсе'}</button>
      </>}>
      <div className="form-title">Основное</div>
      {!isActive && <div className="callout warn"><AlertTriangle size={18} /><div><strong>Редактируется неактивный прайс.</strong> Сохранение изменит только выбранный прайс. Чтобы эти товары появились на сайте, закройте редактор, нажмите «Разместить на сайте» у этого прайса, затем выполните сборку и выкладку во вкладке «Публикация».</div></div>}
      <div className="form-grid">
        <Field label="Название" wide hint="При изменении названия короткое название тоже обновится. При необходимости его можно затем изменить отдельно."><input value={f.name} onChange={(e) => onName(e.target.value)} autoFocus placeholder="Глауконитовый сорбент 1–5 мм" /></Field>
        <Field label="Короткое название" hint="Для карточки и хлебных крошек"><input value={f.shortName} onChange={(e) => { setShortTouched(true); set('shortName', e.target.value) }} /></Field>
        <Field label="Адрес страницы (slug)" error={slugError}
          hint={isNew ? 'Формируется из названия. Потом менять не рекомендуется.' : slugUnlocked ? 'Старый адрес будет автоматически перенаправлять на новый.' : `Сейчас: /catalog/${f.slug}/`}>
          <div className="input-row">
            <input value={f.slug} disabled={!slugUnlocked} onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()) }} />
            {!isNew && <button type="button" className="icon-btn" title={slugUnlocked ? 'Заблокировать' : 'Изменить адрес'} onClick={() => setSlugUnlocked((v) => !v)}>{slugUnlocked ? <Unlock size={16} /> : <Lock size={16} />}</button>}
          </div>
        </Field>
      </div>

      <div className="form-title">Характеристики и цена</div>
      <div className="form-grid three">
        <Field label="Фракция"><input value={f.fraction} onChange={(e) => set('fraction', e.target.value)} placeholder="1–5 мм" /></Field>
        <Field label="Упаковка"><input value={f.packaging} onChange={(e) => set('packaging', e.target.value)} placeholder="Мешки 25 кг, биг-бэги" /></Field>
        <Field label="Минимальная партия"><input value={f.minimum} onChange={(e) => set('minimum', e.target.value)} placeholder="От 10 тонн" /></Field>
        <Field label="Цена" error={priceError} hint={f.onRequest ? 'На сайте будет «По запросу»' : price === null ? 'Пусто = «По запросу»' : `На сайте: ${formatPrice(price as number, f.priceUnit)}`}>
          <input value={f.priceText} disabled={f.onRequest} onChange={(e) => set('priceText', e.target.value)} placeholder="12 000" inputMode="decimal" />
        </Field>
        <Field label="Единица цены"><input value={f.priceUnit} onChange={(e) => set('priceUnit', e.target.value)} placeholder="₽/т" /></Field>
        <Field label=" "><label className="check inline"><input type="checkbox" checked={f.onRequest} onChange={(e) => set('onRequest', e.target.checked)} /> Цена по запросу</label></Field>
      </div>

      <div className="form-title">Изображение</div>
      <div className="image-row">
        <div className="image-preview">{imgSrc ? <img src={imgSrc} alt="Предпросмотр" /> : <span>Нет изображения</span>}</div>
        <div className="image-actions">
          <button className="btn" type="button" onClick={pickFile}><ImagePlus size={16} /> Загрузить файл…</button>
          <button className="btn" type="button" onClick={() => setGallery((v) => !v)}><Images size={16} /> Выбрать из загруженных</button>
          <small className="muted-text">WebP, JPG, PNG или AVIF. Лучше WebP до 300 КБ, пропорции 4:3.<br />Сейчас: <code>{f.image || '—'}</code></small>
        </div>
      </div>
      {gallery && <div className="gallery">{images.map((p) => <GalleryThumb key={p} path={p} active={p === f.image} onPick={() => { set('image', p); setGallery(false) }} />)}</div>}

      <div className="form-title">Описание</div>
      <div className="form-grid">
        <Field label="Описание товара" wide hint={<Counter value={f.description} max={600} />}><textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Области применения" wide hint="По одной в строке — на сайте они выводятся списком"><textarea rows={4} value={f.applications} onChange={(e) => set('applications', e.target.value)} /></Field>
      </div>

      <div className="form-title">Для поисковиков (необязательно)</div>
      <div className="form-grid">
        <Field label="SEO-заголовок" hint={<><Counter value={f.seoTitle} max={70} /> Если пусто — используется «{autoTitle.slice(0, 60)}…»</>}><input value={f.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} /></Field>
        <Field label="SEO-описание" hint={<><Counter value={f.seoDescription} max={170} min={50} /> Если пусто — формируется автоматически</>}><textarea rows={2} value={f.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} /></Field>
      </div>
      <div className="serp">
        <small>Примерный вид в поиске</small>
        <div className="serp-title">{f.seoTitle || autoTitle}</div>
        <div className="serp-url">{app.state.config.siteUrl.replace(/^https?:\/\//, '')} › catalog › {f.slug || '…'}</div>
        <div className="serp-desc">{(f.seoDescription || autoDesc).slice(0, 170)}</div>
      </div>

      <div className="validity">
        {errors.length === 0 ? <div className="callout ok"><CheckCircle2 size={18} /><div>Все обязательные поля заполнены — товар можно публиковать.</div></div>
          : <div className="callout warn"><AlertTriangle size={18} /><div><strong>{f.status === 'published' ? 'Что нужно исправить' : 'Чтобы опубликовать, заполните'}:</strong><IssueList issues={errors} /></div></div>}
        {issues.filter((i) => i.severity === 'warning').length > 0 && <IssueList issues={issues.filter((i) => i.severity === 'warning')} />}
      </div>
    </Modal>
  )
}
