/// <reference types="vite/client" />
import type { Bridge } from '../../shared/api'
declare global {
  interface Window { api: Bridge }
}
