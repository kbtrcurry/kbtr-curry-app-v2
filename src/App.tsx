import type { ReactNode } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './lib/auth'
import { BackHandlerProvider } from './lib/backHandler'
import SetupCheckPage from './pages/SetupCheckPage'
import PosPage from './pages/PosPage'
import AccountingPage from './pages/AccountingPage'
import DashboardPage from './pages/DashboardPage'
import IngredientsPage from './pages/IngredientsPage'
import RecipesPage from './pages/RecipesPage'
import MenuSettingsPage from './pages/MenuSettingsPage'
import PrepPage from './pages/PrepPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 2 },
  },
})

// デスクトップのサイドバーは全項目を表示。モバイルのボトムナビは先頭5件のみ（v1と同じ方式）
const NAV_ITEMS = [
  { to: '/', label: 'レジ', icon: '🛒' },
  { to: '/prep', label: '仕込み', icon: '🍳' },
  { to: '/accounting', label: '会計', icon: '💰' },
  { to: '/dashboard', label: '分析', icon: '📊' },
  { to: '/setup', label: '設定', icon: '⚙️' },
  { to: '/ingredients', label: '食材', icon: '🥬' },
  { to: '/recipes', label: 'レシピ', icon: '📖' },
  { to: '/menus', label: 'メニュー', icon: '🍽️' },
]
const BOTTOM_NAV = NAV_ITEMS.slice(0, 5)

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh md:flex">
      <header className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-stone-200 bg-[#191817]">
        <span className="text-xl leading-none">🍛</span>
        <span className="text-base font-bold text-amber-800">コバタロカレー v2</span>
      </header>

      <aside className="hidden md:flex md:flex-col md:w-52 lg:w-60 shrink-0 border-r border-stone-200 sticky top-0 h-svh">
        <div className="px-4 py-4 text-lg font-bold text-amber-800 flex items-center gap-2">
          <span className="text-xl leading-none">🍛</span>
          コバタロカレー v2
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
              <span className="text-xl">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1 min-w-0 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] md:pb-10">{children}</main>

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
            <span className="text-xl">{item.icon}</span>
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
