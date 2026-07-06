-- =============================================================
-- 締め処理 RPC: 1トランザクションで「セッション確定 + 仕訳生成」
-- 冪等性: journal_entries UNIQUE(source_type, source_id) が二重仕訳を防ぐ
-- =============================================================

-- 締め: セッションを closed にし、仕訳を1本生成する
--   借方: 現金(売上+α) / 地代家賃 / 雑費
--   貸方: 売上高 / 現金（場所代・その他を現金払い想定）
-- 取り置き(reserved_people)は管理会計の概念なので仕訳には入れない
create or replace function close_session(
  p_session_id uuid,
  p_rent integer,
  p_other_cost integer,
  p_groups integer,
  p_people integer,
  p_reserved_people integer default 0,
  p_memo text default ''
)
returns uuid -- 生成した journal_entries.id
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session sales_sessions%rowtype;
  v_sales bigint;
  v_entry_id uuid;
  v_cash uuid;
  v_sales_acct uuid;
  v_rent_acct uuid;
  v_misc_acct uuid;
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;

  select * into v_session
  from sales_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception '営業セッションが見つかりません: %', p_session_id;
  end if;
  if v_session.status = 'closed' then
    raise exception 'この営業はすでに締められています（締め直しは reopen_session を先に実行）';
  end if;

  -- 売上 = 有効な会計の合計
  select coalesce(sum(total), 0) into v_sales
  from receipts
  where session_id = p_session_id and not voided;

  update sales_sessions
     set status = 'closed',
         closed_at = now(),
         rent = coalesce(p_rent, 0),
         other_cost = coalesce(p_other_cost, 0),
         groups = coalesce(p_groups, 0),
         people = coalesce(p_people, 0),
         reserved_people = coalesce(p_reserved_people, 0),
         memo = coalesce(p_memo, '')
   where id = p_session_id;

  select id into v_cash from accounts where code = '101';
  select id into v_sales_acct from accounts where code = '401';
  select id into v_rent_acct from accounts where code = '511';
  select id into v_misc_acct from accounts where code = '529';

  insert into journal_entries (entry_date, description, segment_id, source_type, source_id)
  values (
    v_session.session_date,
    '営業売上 ' || to_char(v_session.session_date, 'YYYY-MM-DD'),
    v_session.segment_id,
    'pos_close',
    p_session_id
  )
  returning id into v_entry_id;

  if v_sales > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo) values
      (v_entry_id, v_cash, 'debit', v_sales::integer, '現金売上'),
      (v_entry_id, v_sales_acct, 'credit', v_sales::integer, '');
  end if;

  if coalesce(p_rent, 0) > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo) values
      (v_entry_id, v_rent_acct, 'debit', p_rent, '場所代'),
      (v_entry_id, v_cash, 'credit', p_rent, '場所代支払');
  end if;

  if coalesce(p_other_cost, 0) > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo) values
      (v_entry_id, v_misc_acct, 'debit', p_other_cost, '当日その他経費'),
      (v_entry_id, v_cash, 'credit', p_other_cost, 'その他経費支払');
  end if;

  -- 売上0・経費0 の営業（ボウズ）は明細なしの仕訳になるため、仕訳ごと消す
  if not exists (select 1 from journal_lines where entry_id = v_entry_id) then
    delete from journal_entries where id = v_entry_id;
    return null;
  end if;

  perform assert_entry_balanced(v_entry_id);
  return v_entry_id;
end;
$$;

-- 締め直し: 仕訳を削除してセッションを再オープン
create or replace function reopen_session(p_session_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;

  if not exists (select 1 from sales_sessions where id = p_session_id) then
    raise exception '営業セッションが見つかりません: %', p_session_id;
  end if;

  delete from journal_entries
   where source_type = 'pos_close' and source_id = p_session_id;

  update sales_sessions
     set status = 'open', closed_at = null
   where id = p_session_id;
end;
$$;
