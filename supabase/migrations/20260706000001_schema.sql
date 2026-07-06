-- =============================================================
-- kbtr-curry-app v2 スキーマ（V2_REDESIGN_SPEC.md §2）
-- 適用方法: Supabase ダッシュボード > SQL Editor に貼り付けて実行
--           （または supabase CLI: supabase db push）
-- =============================================================

-- ---------- 所有者管理（単一ユーザー運用の RLS 基盤） ----------

create table app_config (
  id boolean primary key default true check (id), -- 1行しか入らない
  owner_user_id uuid references auth.users (id)
);

insert into app_config (id, owner_user_id) values (true, null);

-- 最初にログインしたユーザーが1回だけ所有者になれる
create or replace function claim_ownership()
returns boolean
language sql
security definer
set search_path = public
as $$
  update app_config
     set owner_user_id = auth.uid()
   where id and owner_user_id is null and auth.uid() is not null
  returning true;
$$;

create or replace function is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and auth.uid() = (select owner_user_id from app_config where id);
$$;

alter table app_config enable row level security;
create policy "owner reads config" on app_config
  for select to authenticated using (true); -- 所有者未設定かどうかは誰でも見てよい

-- ---------- 会計コア（財務会計） ----------

create table segments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  active boolean not null default true,
  sort_order integer not null default 0
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  description text not null default '',
  segment_id uuid not null references segments (id),
  source_type text not null default 'manual'
    check (source_type in ('pos_close', 'expense', 'platform_revenue', 'manual', 'migration')),
  source_id uuid,
  created_at timestamptz not null default now(),
  unique (source_type, source_id) -- 同じ由来からの二重生成を構造的に禁止
);

create table journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references journal_entries (id) on delete cascade,
  account_id uuid not null references accounts (id),
  side text not null check (side in ('debit', 'credit')),
  amount integer not null check (amount > 0), -- 円・税込（税込経理方式）
  memo text not null default ''
);

create index idx_journal_entries_date on journal_entries (entry_date);
create index idx_journal_entries_segment on journal_entries (segment_id, entry_date);
create index idx_journal_lines_entry on journal_lines (entry_id);
create index idx_journal_lines_account on journal_lines (account_id);

-- 仕訳の貸借一致チェック（RPC・アプリ層から明示的に呼ぶ）
create or replace function assert_entry_balanced(p_entry_id uuid)
returns void
language plpgsql
as $$
declare
  v_debit bigint;
  v_credit bigint;
begin
  select
    coalesce(sum(amount) filter (where side = 'debit'), 0),
    coalesce(sum(amount) filter (where side = 'credit'), 0)
  into v_debit, v_credit
  from journal_lines
  where entry_id = p_entry_id;

  if v_debit <> v_credit then
    raise exception '仕訳 % の貸借が一致しません（借方 % / 貸方 %）', p_entry_id, v_debit, v_credit;
  end if;
end;
$$;

-- ---------- 営業・レジ ----------

create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_rent integer not null default 0,
  memo text not null default ''
);

create table sales_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null,
  venue_id uuid references venues (id),
  segment_id uuid not null references segments (id),
  status text not null default 'open' check (status in ('open', 'closed')),
  groups integer not null default 0,
  people integer not null default 0,
  reserved_people integer not null default 0, -- 取り置き（管理会計用。仕訳には入れない）
  rent integer not null default 0,
  other_cost integer not null default 0,
  memo text not null default '',
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_sales_sessions_date on sales_sessions (session_date);

create table receipts (
  id uuid primary key, -- クライアント生成UUID（オフラインキューの再送で upsert）
  session_id uuid not null references sales_sessions (id),
  total integer not null default 0,
  received integer not null default 0,
  people integer not null default 1,
  voided boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_receipts_session on receipts (session_id);

create table receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts (id) on delete cascade,
  menu_id uuid, -- NULL = 手動金額入力。マスタ削除に耐えるよう FK は張らない
  name_snapshot text not null,
  qty integer not null check (qty > 0),
  unit_price integer not null
);

create index idx_receipt_lines_receipt on receipt_lines (receipt_id);

-- ---------- 商品・レシピ・食材（管理会計の素材） ----------

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '',
  unit text not null default 'g',
  unit_price_per_g numeric, -- 手動上書き。NULL なら pack_price / pack_weight_g で導出
  pack_weight_g numeric,
  pack_price integer,
  stock_g numeric not null default 0,
  alert_threshold_g numeric,
  supplier text not null default '',
  memo text not null default '',
  created_at timestamptz not null default now()
);

create table ingredient_purchases (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid references ingredients (id),
  purchased_on date not null,
  quantity numeric,
  total_price integer not null,
  journal_entry_id uuid references journal_entries (id) on delete set null,
  memo text not null default ''
);

create index idx_ing_purchases_date on ingredient_purchases (purchased_on);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dish_type text not null default '',
  yield_g numeric,
  serving_weight_g numeric,
  servings numeric,
  sale_price integer,
  memo text not null default '',
  created_at timestamptz not null default now()
);

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id),
  quantity numeric not null,
  unit text not null default 'g',
  memo text not null default ''
);

create index idx_recipe_ingredients_recipe on recipe_ingredients (recipe_id);

create table menus (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price integer not null,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table menu_components (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references menus (id) on delete cascade,
  recipe_id uuid not null references recipes (id),
  servings numeric not null default 1
);

-- ---------- RLS（全テーブル: 所有者のみフルアクセス） ----------

do $$
declare
  t text;
begin
  foreach t in array array[
    'segments', 'accounts', 'journal_entries', 'journal_lines',
    'venues', 'sales_sessions', 'receipts', 'receipt_lines',
    'ingredients', 'ingredient_purchases', 'recipes', 'recipe_ingredients',
    'menus', 'menu_components'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "owner full access" on %I for all to authenticated using (is_owner()) with check (is_owner())',
      t
    );
  end loop;
end;
$$;
