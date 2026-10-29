import { createContext, useContext } from 'react'
import type { AppState, PreflightResult } from '../../shared/types'

export type PageId = 'dashboard' | 'products' | 'content' | 'publish' | 'settings'
export interface Focus { page: PageId; productId?: string; field?: string }

export interface AppCtx {
  state: AppState
  preflight: PreflightResult | null
  refreshState: (s?: AppState) => Promise<void>
  refreshPreflight: () => Promise<void>
  go: (page: PageId, focus?: Partial<Focus>) => void
  focus: Focus
  clearFocus: () => void
}
export const App = createContext<AppCtx>(null as unknown as AppCtx)
export const useApp = () => useContext(App)

/** Переход по ссылке «Исправить» из списка проблем. */
export function goToIssue(app: AppCtx, where: string) {
  const [kind, id] = where.split(':')
  if (kind === 'product') app.go('products', { productId: id })
  else if (kind === 'settings') app.go('content', { field: id })
  else if (kind === 'server') app.go('settings')
  else app.go('products')
}
