// ログイン直後に主要マスタデータを取得してTanStack Queryのキャッシュを温める。
// これにより各タブを初めて開いたときの「読み込み中」表示が出にくくなる。
import type { QueryClient } from '@tanstack/react-query'
import {
  fetchIngredients,
  fetchRecipes,
  fetchAllRecipeIngredients,
  fetchAllMenus,
  fetchAllMenuComponents,
} from './masterData'
import { fetchSegments, fetchAccounts } from './accounting'
import { fetchActiveMenus } from './pos'

let started = false

/** 主要データを並列取得し、各クエリキーへ書き込む。1セッション1回のみ実行。 */
export async function preloadAll(queryClient: QueryClient): Promise<void> {
  if (started) return
  started = true
  try {
    await Promise.all([
      queryClient.prefetchQuery({ queryKey: ['ingredients'], queryFn: fetchIngredients, staleTime: 60_000 }),
      queryClient.prefetchQuery({ queryKey: ['recipes'], queryFn: fetchRecipes, staleTime: 60_000 }),
      queryClient.prefetchQuery({
        queryKey: ['recipe_ingredients', 'all'],
        queryFn: fetchAllRecipeIngredients,
        staleTime: 30_000,
      }),
      queryClient.prefetchQuery({ queryKey: ['menus', 'all'], queryFn: fetchAllMenus, staleTime: 30_000 }),
      queryClient.prefetchQuery({
        queryKey: ['menu_components', 'all'],
        queryFn: fetchAllMenuComponents,
        staleTime: 30_000,
      }),
      queryClient.prefetchQuery({ queryKey: ['menus', 'active'], queryFn: fetchActiveMenus, staleTime: 60_000 }),
      queryClient.prefetchQuery({ queryKey: ['segments'], queryFn: fetchSegments, staleTime: 5 * 60_000 }),
      queryClient.prefetchQuery({
        queryKey: ['accounts', 'expense'],
        queryFn: () => fetchAccounts('expense'),
        staleTime: 5 * 60_000,
      }),
      queryClient.prefetchQuery({
        queryKey: ['accounts', 'all'],
        queryFn: () => fetchAccounts(),
        staleTime: 5 * 60_000,
      }),
    ])
  } catch {
    // 失敗しても各ページが自前で再取得するので握りつぶす
    started = false
  }
}
