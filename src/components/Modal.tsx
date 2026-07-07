import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  children: ReactNode
  onClose?: () => void
}

// document.body直下にポータルで描画する。
// アプリ内のflex/stickyなレイアウトの影響を受けず、スクロール位置に関わらず
// 常に画面中央に固定表示するための共通モーダル。
export function Modal({ children, onClose }: Props) {
  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
