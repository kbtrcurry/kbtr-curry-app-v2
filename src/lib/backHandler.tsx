import { createContext, useContext, useEffect, useRef, type ReactNode, type MutableRefObject } from 'react'

// 各ページが「画面内で一段階戻る」操作を登録する仕組み。
// 戻れた場合は true を返す。戻る対象が無ければ false（＝スワイプは何もしない）。
export type BackFn = () => boolean

const BackHandlerContext = createContext<MutableRefObject<BackFn | null> | null>(null)

export function BackHandlerProvider({ children }: { children: ReactNode }) {
  const ref = useRef<BackFn | null>(null)
  return <BackHandlerContext.Provider value={ref}>{children}</BackHandlerContext.Provider>
}

/** 現在のページの「戻る」ハンドラを登録する。最新のクロージャを常に保持。 */
export function useRegisterBack(fn: BackFn) {
  const ref = useContext(BackHandlerContext)
  useEffect(() => {
    if (!ref) return
    ref.current = fn
    return () => {
      if (ref.current === fn) ref.current = null
    }
  })
}

export function useBackHandlerRef() {
  return useContext(BackHandlerContext)
}
