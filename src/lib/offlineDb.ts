// レジのオフライン耐性を支える最小限の IndexedDB ラッパー。
// 「セッション（1営業）」「会計（レシート）」をそれぞれローカルの唯一の正として保持し、
// 同期済みかどうかを synced フラグで管理する（queue.ts が Supabase への反映を担当）。

const DB_NAME = 'kbtr_pos_v2'
const DB_VERSION = 1
const STORE_SESSIONS = 'sessions'
const STORE_RECEIPTS = 'receipts'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_RECEIPTS)) {
        db.createObjectStore(STORE_RECEIPTS, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const req = fn(tx.objectStore(storeName))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function makeStore<T extends { id: string }>(storeName: string) {
  return {
    put: (row: T) => withStore<IDBValidKey>(storeName, 'readwrite', (s) => s.put(row)),
    get: (id: string) => withStore<T | undefined>(storeName, 'readonly', (s) => s.get(id)),
    getAll: () => withStore<T[]>(storeName, 'readonly', (s) => s.getAll()),
    delete: (id: string) => withStore<undefined>(storeName, 'readwrite', (s) => s.delete(id)),
  }
}

export type LocalSessionRow = {
  id: string
  session_date: string
  segment_id: string
  status: 'open' | 'closed'
  synced: boolean
}

export type LocalReceiptLine = {
  id: string
  menuId: string | null
  nameSnapshot: string
  qty: number
  unitPrice: number
}

export type LocalReceiptRow = {
  id: string
  sessionId: string
  total: number
  received: number
  people: number
  voided: boolean
  createdAt: string
  lines: LocalReceiptLine[]
  synced: boolean
}

export const localSessions = makeStore<LocalSessionRow>(STORE_SESSIONS)
export const localReceipts = makeStore<LocalReceiptRow>(STORE_RECEIPTS)
