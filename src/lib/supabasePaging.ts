// Supabase(PostgREST)は1クエリあたり最大1000行しか返さない。
// 4000行超のテーブル（食材明細など）を範囲指定なしで取得すると、
// 後半のデータが無言で欠落し、原価計算などが不正確になる。
// range()で全件を取り切るまでページング取得する共通ヘルパー。
const PAGE_SIZE = 1000

export async function fetchAllPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}
