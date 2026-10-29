import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, Copy, CopyPlus, Eye, EyeOff, ImageOff, Info, Package, Pencil, Plus, Search, Settings2, Trash2 } from 'lucide-react'
import type { PriceListsFile, ProductInput, ProductRecord } from '../../../shared/types'
import { formatPrice } from '../../../shared/price'
import { api } from '../api'
import { useApp } from '../appctx'
import { Empty, Page, Pill, useImage, useUi } from '../ui'
import ProductEditor from './ProductEditor'
import { CopyToDialog, PriceListDialog, fmtListDate } from './PriceListDialogs'

export const toInput = (p: ProductRecord): ProductInput => { const { oldSlugs: _o, ...rest } = p; return rest }

function Thumb({ path }: { path: string }) {
  const src = useImage(path)
  return <div className="thumb">{src ? <img src={src} alt="" /> : <ImageOff size={16} />}</div>
}

export default function Products() {
  const app = useApp()
  const { run, confirm, toast } = useUi()
  const [lists, setLists] = useState<PriceListsFile | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all')
  const [editing, setEditing] = useState<ProductRecord | 'new' | null>(null)
  const [dialog, setDialog] = useState<'create' | 'edit' | null>(null)
  const [copying, setCopying] = useState<ProductRecord | null>(null)

  const load = useCallback(async () => { const f = await run(() => api.listPriceLists()); if (f) { setLists(f); setSelId((cur) => (cur && f.lists.some((l) => l.id === cur) ? cur : f.activeId)) } }, [run])
  useEffect(() => { void load() }, [load])

  const list = useMemo(() => lists?.lists.find((l) => l.id === selId) ?? null, [lists, selId])
  const isActive = !!lists && !!list && list.id === lists.activeId
  const activeName = lists?.lists.find((l) => l.id === lists.activeId)?.name ?? ''

  // переход по ссылке «Исправить» открывает нужный товар (ошибки относятся к прайсу, который на сайте)
  useEffect(() => {
    if (lists && app.focus.productId) {
      const active = lists.lists.find((l) => l.id === lists.activeId)
      const p = active?.products.find((x) => x.id === app.focus.productId)
      if (p && active) { setSelId(active.id); setEditing(p) }
      app.clearFocus()
    }
  }, [lists, app])

  const apply = async (f: PriceListsFile | undefined) => { if (f) { setLists(f); await app.refreshPreflight(); await app.refreshState() } }

  const products = list?.products ?? []
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((p) => (filter === 'all' || p.status === filter) && (!q || `${p.name} ${p.slug} ${p.fraction}`.toLowerCase().includes(q)))
  }, [products, query, filter])
  const canReorder = !query.trim() && filter === 'all'

  const toggle = async (p: ProductRecord) => {
    const r = await run(() => api.saveProduct({ ...toInput(p), status: p.status === 'published' ? 'draft' : 'published' }, list!.id))
    if (r) { await apply(r.file); toast('info', p.status === 'published' ? `«${p.name}» скрыт с сайта (после выкладки)` : `«${p.name}» будет показан на сайте после выкладки`) }
  }
  const remove = async (p: ProductRecord) => {
    if (!(await confirm({ title: 'Удалить товар?', text: `«${p.name}» будет удалён из прайса «${list!.name}». ${isActive ? 'Если он уже на сайте, то исчезнет после следующей выкладки. ' : ''}Вернуть можно из резервной копии (Настройки → Резервные копии). Чтобы просто скрыть товар, переведите его в черновик.`, ok: 'Удалить', danger: true }))) return
    await apply(await run(() => api.deleteProduct(p.id, list!.id), 'Товар удалён'))
  }

  const activate = async () => {
    const date = list!.priceListDate ? ` Дата прайса на сайте станет ${fmtListDate(list!.priceListDate)}` : ''
    if (!(await confirm({ title: `Разместить «${list!.name}» на сайте?`, text: `Вместо прайса «${activeName}» на сайте будут товары и цены из «${list!.name}» — после следующей выкладки (вкладка «Публикация» покажет, что изменится).${date}`, ok: 'Разместить на сайте' }))) return
    const f = await run(() => api.activatePriceList(list!.id))
    if (f) { await apply(f); toast('success', `«${list!.name}» размещён на сайте — осталось собрать и выложить сайт`) }
  }
  const removeList = async () => {
    if (!(await confirm({ title: 'Удалить прайс?', text: `Прайс «${list!.name}» и все его товары (${products.length}) будут удалены. Вернуть можно из резервной копии (Настройки → Резервные копии).`, ok: 'Удалить прайс', danger: true }))) return
    const f = await run(() => api.deletePriceList(list!.id), 'Прайс удалён')
    if (f) { setSelId(f.activeId); await apply(f) }
  }

  return (
    <Page title="Товары" subtitle="Каталог сайта: цены, описания, фото. Товары собраны в прайсы — на сайте показывается один из них."
      actions={<button className="btn primary" disabled={!list} onClick={() => setEditing('new')}><Plus size={16} /> Добавить товар</button>}>

      {lists && list && (
        <div className="card pricelists">
          <div className="pl-tabs" role="tablist" aria-label="Прайсы">
            {lists.lists.map((l) => (
              <button key={l.id} role="tab" aria-selected={l.id === selId} className={`pl-tab${l.id === selId ? ' active' : ''}`} onClick={() => { setSelId(l.id); setQuery(''); setFilter('all') }}>
                <strong>{l.name}</strong>
                <small>{l.priceListDate ? fmtListDate(l.priceListDate) : 'без даты'} · {l.products.length} тов.</small>
                {l.id === lists.activeId && <span className="pl-live"><CheckCircle2 size={12} /> на сайте</span>}
              </button>
            ))}
            <button className="pl-tab add" onClick={() => setDialog('create')}><Plus size={16} /> Новый прайс</button>
          </div>
          <div className="pl-bar">
            {isActive ? (
              <span className="pl-state live"><CheckCircle2 size={15} /> Этот прайс сейчас размещён на сайте</span>
            ) : (
              <span className="pl-state"><Info size={15} /> Этот прайс не на сайте. На сайте сейчас — «{activeName}». Правки здесь сайт не меняют, пока вы не разместите прайс.</span>
            )}
            <div className="btn-row">
              {!isActive && <button className="btn primary small" onClick={activate}><CheckCircle2 size={14} /> Разместить на сайте</button>}
              <button className="btn small" onClick={() => setDialog('edit')}><Settings2 size={14} /> Название и дата</button>
              {!isActive && <button className="btn small danger-text" onClick={removeList}><Trash2 size={14} /> Удалить прайс</button>}
            </div>
          </div>
        </div>
      )}

      <div className="toolbar">
        <label className="search"><Search size={16} /><input placeholder="Поиск по названию, адресу, фракции" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">Все</option><option value="published">Опубликованные</option><option value="draft">Черновики</option>
        </select>
        <span className="muted-text">{visible.length} из {products.length}</span>
      </div>

      {list && products.length === 0 ? (
        <div className="card"><Empty icon={<Package size={26} />} title="В этом прайсе нет товаров" text="Добавьте первый товар или скопируйте товары из другого прайса." action={<button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} /> Добавить товар</button>} /></div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead><tr><th>Товар</th><th>Фракция / упаковка</th><th>Цена</th><th>Статус</th><th className="right">Действия</th></tr></thead>
            <tbody>
              {visible.map((p) => {
                const idx = products.findIndex((x) => x.id === p.id)
                return (
                  <tr key={p.id} className={p.status === 'draft' ? 'dim' : ''}>
                    <td><div className="cell-product"><Thumb path={p.image} /><div><strong>{p.name || '(без названия)'}</strong><small>/catalog/{p.slug}/</small></div></div></td>
                    <td><div>{p.fraction || '—'}</div><small className="muted-text">{p.packaging || '—'}</small></td>
                    <td className="nowrap"><strong>{formatPrice(p.price, p.priceUnit)}</strong></td>
                    <td><button className="pill-btn" title={p.status === 'published' ? 'Скрыть с сайта' : 'Показать на сайте'} onClick={() => toggle(p)}>
                      {p.status === 'published' ? <Pill kind="published"><Eye size={12} /> {isActive ? 'На сайте' : 'Опубликован'}</Pill> : <Pill kind="draft"><EyeOff size={12} /> Черновик</Pill>}
                    </button></td>
                    <td><div className="row-actions">
                      <button className="icon-btn" title="Выше" disabled={!canReorder || idx === 0} onClick={async () => apply(await run(() => api.moveProduct(p.id, -1, list!.id)))}><ArrowUp size={16} /></button>
                      <button className="icon-btn" title="Ниже" disabled={!canReorder || idx === products.length - 1} onClick={async () => apply(await run(() => api.moveProduct(p.id, 1, list!.id)))}><ArrowDown size={16} /></button>
                      <button className="icon-btn" title="Редактировать" onClick={() => setEditing(p)}><Pencil size={16} /></button>
                      <button className="icon-btn" title="Дублировать" onClick={async () => apply(await run(() => api.duplicateProduct(p.id, list!.id), 'Создана копия-черновик'))}><Copy size={16} /></button>
                      <button className="icon-btn" title="Копировать в другой прайс" disabled={(lists?.lists.length ?? 0) < 2} onClick={() => setCopying(p)}><CopyPlus size={16} /></button>
                      <button className="icon-btn danger" title="Удалить" onClick={() => remove(p)}><Trash2 size={16} /></button>
                    </div></td>
                  </tr>
                )
              })}
              {list && visible.length === 0 && <tr><td colSpan={5}><Empty icon={<Search size={24} />} title="Ничего не найдено" text="Измените поисковый запрос или фильтр." /></td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {!canReorder && <p className="muted-text hint-line">Порядок товаров можно менять, когда поиск и фильтр сброшены.</p>}

      {editing && list && (
        <ProductEditor
          product={editing === 'new' ? null : editing}
          file={{ schemaVersion: 2, products: list.products }}
          listId={list.id}
          isActive={isActive}
          onClose={() => setEditing(null)}
          onSaved={async (f) => { setEditing(null); await apply(f) }}
        />
      )}
      {dialog && lists && list && (
        <PriceListDialog mode={dialog} lists={lists} current={list} onClose={() => setDialog(null)}
          onDone={async (f, id) => { setDialog(null); setSelId(id); await apply(f) }} />
      )}
      {copying && lists && list && (
        <CopyToDialog lists={lists} fromId={list.id} productId={copying.id} productName={copying.name} onClose={() => setCopying(null)}
          onDone={async (f) => { setCopying(null); await apply(f) }} />
      )}
    </Page>
  )
}
