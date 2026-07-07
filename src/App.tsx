import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  ShoppingCart,
  Wallet,
  BarChart3,
  Carrot,
  BookOpen,
  UtensilsCrossed,
  Receipt,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { AuthProvider, useAuth } from './lib/auth'
import { BackHandlerProvider } from './lib/backHandler'
import { preloadAll } from './lib/preload'
import SetupCheckPage from './pages/SetupCheckPage'
import PosPage from './pages/PosPage'
import AccountingPage from './pages/AccountingPage'
import DashboardPage from './pages/DashboardPage'
import IngredientsPage from './pages/IngredientsPage'
import RecipesPage from './pages/RecipesPage'
import MenuSettingsPage from './pages/MenuSettingsPage'
import PrepPage from './pages/PrepPage'
import TaxPage from './pages/TaxPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 2 },
  },
})

type NavItem = { to: string; label: string; icon: LucideIcon }

// デスクトップのサイドバーは全項目を表示。モバイルのボトムナビは頻度の高いものだけ（残りは設定タブ内のハブから）
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'レジ', icon: ShoppingCart },
  { to: '/accounting', label: '会計', icon: Wallet },
  { to: '/dashboard', label: '分析', icon: BarChart3 },
  { to: '/ingredients', label: '食材', icon: Carrot },
  { to: '/recipes', label: 'レシピ', icon: BookOpen },
  { to: '/menus', label: 'メニュー', icon: UtensilsCrossed },
  { to: '/tax', label: '申告', icon: Receipt },
  { to: '/setup', label: '設定', icon: Settings },
]
const BOTTOM_NAV_PATHS = new Set(['/', '/accounting', '/dashboard', '/setup'])
const BOTTOM_NAV = NAV_ITEMS.filter((item) => BOTTOM_NAV_PATHS.has(item.to))

function UpdateButton() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, reg) {
      // 1時間ごとに更新確認
      if (reg) setInterval(() => reg.update(), 60 * 60 * 1000)
    },
  })

  // 新バージョンを検知したら自動で適用＆再読み込み（手動タップ不要）
  useEffect(() => {
    if (needRefresh) updateServiceWorker(true)
  }, [needRefresh, updateServiceWorker])

  return (
    <button
      onClick={() => window.location.reload()}
      title={`v${__APP_VERSION__}.${__BUILD_DATE__} — タップで再読み込み`}
      className="text-xl leading-none transition-transform active:scale-90"
    >
      🍛
    </button>
  )
}

// ログイン後、全画面ぶんのデータを先読みしてキャッシュを温める
function Preloader() {
  const { session } = useAuth()
  useEffect(() => {
    if (session) void preloadAll(queryClient)
  }, [session])
  return null
}

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh md:flex">
      <header className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-stone-200 bg-[#191817]">
        <UpdateButton />
        <span className="text-base font-bold text-amber-800">コバタロカレー v2</span>
        <span className="text-xs text-stone-400">v{__APP_VERSION__}.{__BUILD_DATE__}</span>
      </header>

      <aside className="hidden md:flex md:flex-col md:w-52 lg:w-60 shrink-0 border-r border-stone-200 md:fixed md:inset-y-0 md:left-0 h-svh z-30">
        <div className="px-4 py-4 text-lg font-bold text-amber-800 flex items-center gap-2">
          <UpdateButton />
          コバタロカレー v2
          <span className="text-xs font-normal text-stone-400">v{__APP_VERSION__}</span>
        </div>
        <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-amber-100 text-amber-800 font-semibold' : 'text-stone-600 hover:bg-stone-100'
                }`
              }
            >
              <item.icon className="w-5 h-5" strokeWidth={2} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1 min-w-0 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-10 md:ml-52 lg:ml-60">{children}</main>

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 flex z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {BOTTOM_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs gap-0.5 transition-colors ${
                isActive ? 'text-amber-700 font-semibold' : 'text-stone-400'
              }`
            }
          >
            <item.icon className="w-6 h-6" strokeWidth={2} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter basename="/kbtr-curry-app-v2">
          <Preloader />
          <BackHandlerProvider>
            <Layout>
              <div className="mx-auto w-full max-w-screen-sm lg:max-w-3xl">
                <Routes>
                  <Route path="/" element={<PosPage />} />
                  <Route path="/accounting" element={<AccountingPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/ingredients" element={<IngredientsPage />} />
                  <Route path="/recipes" element={<RecipesPage />} />
                  <Route path="/menus" element={<MenuSettingsPage />} />
                  <Route path="/prep" element={<PrepPage />} />
                  <Route path="/tax" element={<TaxPage />} />
                  <Route path="/setup" element={<SetupCheckPage />} />
                </Routes>
              </div>
            </Layout>
          </BackHandlerProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
