# kbtr-curry-app v2

コバタロカレー業務管理アプリの全面再設計版。設計書: [`../kbtr-curry-app/docs/V2_REDESIGN_SPEC.md`](../kbtr-curry-app/docs/V2_REDESIGN_SPEC.md)

- データ基盤: **Supabase**（Postgres + Auth + RPC）
- 会計: 複式簿記の仕訳を自動生成、事業セグメント別（間借り/note/YouTube/イベント）、青色申告対応
- フロント: React + TypeScript + Vite + Tailwind v4 + PWA（v1 と同じスタック）

## セットアップ（Phase 0）

1. **Supabase プロジェクト作成**: https://supabase.com/dashboard → New project（無料枠でOK、リージョンは Tokyo 推奨）
2. **スキーマ適用**: ダッシュボード > SQL Editor で `supabase/migrations/` の3ファイルを番号順に実行
   1. `20260706000001_schema.sql` — テーブル + RLS
   2. `20260706000002_seed.sql` — セグメント・勘定科目の初期データ
   3. `20260706000003_close_session_rpc.sql` — 締め処理 RPC
3. **Google ログイン有効化**: Authentication > Providers > Google を ON（v1 の Google Cloud OAuth クライアントを流用可。リダイレクト URI に Supabase の callback URL を追加）
4. **環境変数**: `.env.example` を `.env` にコピーし、Settings > API の URL / anon key を記入
5. `npm install && npm run dev` → セットアップ確認画面でログイン・スキーマ疎通を確認
   （最初にログインしたアカウントが自動的に所有者として登録され、以降そのアカウントだけがデータにアクセス可能）

## データ移行（v1 → v2）

`../99_system_tools/migrate-v1-to-v2/migrate.mjs` を参照。dry-run で件数・金額を現行ダッシュボードと突合してから `--apply`。

## デプロイ

GitHub リポジトリの Secrets に `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を設定 → master/main に push で GitHub Pages に自動デプロイ。
