import { useState } from 'react'
import type { PriceList, PriceListsFile } from '../../../shared/types'
import { api } from '../api'
import { Field, Modal, useUi } from '../ui'

/** «2026-02-01» → «1 февраля 2026 г.» (без сдвига по часовому поясу). */
export function fmtListDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ''
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) // «1 февраля 2026 г.»
}

/** Создание нового прайса или смена названия/даты существующего. */
export function PriceListDialog({ mode, lists, current, onClose, onDone }: {
  mode: 'create' | 'edit'
  lists: PriceListsFile
  /** create: прайс, который предлагается скопировать; edit: редактируемый прайс. */
  current: PriceList
  onClose: () => void
  onDone: (file: PriceListsFile, selectId: string) => void | Promise<void>
}) {
  const { run } = useUi()
  const nextName = () => { let i = lists.lists.length + 1; while (lists.lists.some((l) => l.name === `Прайс_${i}`)) i++; return `Прайс_${i}` }
  const [name, setName] = useState(mode === 'edit' ? current.name : nextName())
  const [date, setDate] = useState(mode === 'edit' ? current.priceListDate : '')
  const [source, setSource] = useState<'copy' | 'empty'>('copy')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    if (mode === 'create') {
      const r = await run(() => api.createPriceList({ name, priceListDate: date || undefined, copyFromId: source === 'copy' ? current.id : null }), 'Прайс создан')
      setBusy(false)
      if (r) await onDone(r.file, r.id)
    } else {
      const f = await run(() => api.updatePriceList(current.id, { name, priceListDate: date }), 'Сохранено')
      setBusy(false)
      if (f) await onDone(f, current.id)
    }
  }

  return (
    <Modal title={mode === 'create' ? 'Новый прайс' : 'Параметры прайса'} width={520} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn primary" disabled={busy || !name.trim()} onClick={submit}>{mode === 'create' ? 'Создать' : 'Сохранить'}</button></>}>
      <div className="form-grid one">
        <Field label="Название прайса" hint="Например: Прайс_3 или «Прайс на лето»"><input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()} /></Field>
        <Field label="Дата прайса" hint={`Когда прайс размещается на сайте, эта дата выводится как «Прайс-лист актуален на …». ${mode === 'create' ? (source === 'copy' ? 'Пусто — будет дата исходного прайса.' : 'Пусто — прайс без даты.') : 'Пусто — дату на сайте не менять.'}`}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {mode === 'create' && (
          <div className="field">
            <span>С чего начать</span>
            <label className="check"><input type="radio" name="src" checked={source === 'copy'} onChange={() => setSource('copy')} /> Копия прайса «{current.name}» ({current.products.length} товаров) — удобно менять только цены</label>
            <label className="check"><input type="radio" name="src" checked={source === 'empty'} onChange={() => setSource('empty')} /> Пустой прайс — товары добавите сами</label>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Копирование товара в другой прайс. */
export function CopyToDialog({ lists, fromId, productId, productName, onClose, onDone }: {
  lists: PriceListsFile; fromId: string; productId: string; productName: string
  onClose: () => void; onDone: (file: PriceListsFile) => void | Promise<void>
}) {
  const { run } = useUi()
  const others = lists.lists.filter((l) => l.id !== fromId)
  const [to, setTo] = useState(others[0]?.id ?? '')
  const submit = async () => {
    const f = await run(() => api.copyProductToList(productId, fromId, to), 'Товар скопирован')
    if (f) await onDone(f)
  }
  return (
    <Modal title="Копировать в другой прайс" width={460} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn primary" disabled={!to} onClick={submit}>Копировать</button></>}>
      {others.length === 0 ? <p className="muted-text" style={{ margin: 0 }}>Других прайсов пока нет — сначала создайте новый.</p> : (
        <div className="form-grid one">
          <p className="muted-text" style={{ margin: 0 }}>Товар «{productName}» будет добавлен в выбранный прайс. В исходном он останется.</p>
          <Field label="В какой прайс">
            <select value={to} onChange={(e) => setTo(e.target.value)}>{others.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </Field>
        </div>
      )}
    </Modal>
  )
}
