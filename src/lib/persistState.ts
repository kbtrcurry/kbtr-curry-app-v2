import { useEffect, useState } from 'react'

// タブ切替（ページ再マウント）をまたいで画面状態を保持するためのフック。
// sessionStorage に保存するので、アプリを開いている間は保持され、閉じるとリセットされる。
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key)
      return raw !== null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state))
    } catch {
      /* ignore */
    }
  }, [key, state])
  return [state, setState]
}
