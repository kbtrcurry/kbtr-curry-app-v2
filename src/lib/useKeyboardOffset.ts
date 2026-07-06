import { useState, useEffect } from 'react'

// iOS Safari でソフトキーボードが表示されたときの下端オフセット(px)を返す。
// fixed bottom:0 のモーダルに paddingBottom として適用するとボタンが隠れない。
export function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setOffset(Math.max(0, window.innerHeight - vv.offsetTop - vv.height))
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return offset
}
