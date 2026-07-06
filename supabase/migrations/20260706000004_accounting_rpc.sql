-- =============================================================
-- Phase 2: 会計タブ RPC（経費入力・note/YouTube収入登録）
-- 経費・収入登録はクライアント生成UUIDをそのまま journal_entries.source_id に使うことで、
-- 「同じ入力の訂正（再送）」を安全に冪等処理できる（レジ締めと同じ設計）。
-- ユーザーには複式簿記を見せず、フォーム入力からここで仕訳を自動生成する。
-- =============================================================

-- 経費入力: 勘定科目(カテゴリ)を借方、現金/普通預金を貸方に記帳
create or replace function record_expense(
  p_id uuid,
  p_entry_date date,
  p_segment_id uuid,
  p_account_id uuid,
  p_amount integer,
  p_payment_method text, -- 'cash' | 'bank'
  p_memo text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_cash_account_id uuid;
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;
  if p_amount <= 0 then
    raise exception '金額は1円以上で入力してください';
  end if;

  select id into v_cash_account_id from accounts
    where code = case p_payment_method when 'bank' then '102' else '101' end;
  if v_cash_account_id is null then
    raise exception '支払方法が不正です: %', p_payment_method;
  end if;

  -- 訂正: 既存の仕訳があれば削除してから作り直す（source_id は呼び出し元が同じidを渡す）
  delete from journal_entries where source_type = 'expense' and source_id = p_id;

  insert into journal_entries (id, entry_date, description, segment_id, source_type, source_id)
  values (gen_random_uuid(), p_entry_date, coalesce(p_memo, ''), p_segment_id, 'expense', p_id)
  returning id into v_entry_id;

  insert into journal_lines (entry_id, account_id, side, amount, memo) values
    (v_entry_id, p_account_id, 'debit', p_amount, coalesce(p_memo, '')),
    (v_entry_id, v_cash_account_id, 'credit', p_amount, coalesce(p_memo, ''));

  perform assert_entry_balanced(v_entry_id);
  return v_entry_id;
end;
$$;

-- note/YouTube 収入登録: 入金額(手数料差引後)+手数料 を借方、売上高を貸方に記帳
create or replace function record_platform_revenue(
  p_id uuid,
  p_entry_date date,
  p_segment_id uuid,
  p_gross integer, -- 売上総額（手数料込）
  p_fee integer,   -- プラットフォーム手数料
  p_memo text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_net integer;
  v_cash_account_id uuid;
  v_fee_account_id uuid;
  v_revenue_account_id uuid;
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;
  if p_gross <= 0 or p_fee < 0 or p_fee > p_gross then
    raise exception '金額が不正です';
  end if;

  v_net := p_gross - p_fee;

  select id into v_cash_account_id from accounts where code = '102';
  select id into v_fee_account_id from accounts where code = '521';
  select id into v_revenue_account_id from accounts where code = '401';

  delete from journal_entries where source_type = 'platform_revenue' and source_id = p_id;

  insert into journal_entries (id, entry_date, description, segment_id, source_type, source_id)
  values (gen_random_uuid(), p_entry_date, coalesce(p_memo, ''), p_segment_id, 'platform_revenue', p_id)
  returning id into v_entry_id;

  if v_net > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo) values
      (v_entry_id, v_cash_account_id, 'debit', v_net, coalesce(p_memo, ''));
  end if;

  if p_fee > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo) values
      (v_entry_id, v_fee_account_id, 'debit', p_fee, coalesce(p_memo, ''));
  end if;

  insert into journal_lines (entry_id, account_id, side, amount, memo) values
    (v_entry_id, v_revenue_account_id, 'credit', p_gross, coalesce(p_memo, ''));

  perform assert_entry_balanced(v_entry_id);
  return v_entry_id;
end;
$$;

-- 仕訳の取り消し（経費・収入登録・手動仕訳のみ。レジ締めは reopen_session を使う）
create or replace function delete_journal_entry(p_entry_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_source_type text;
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;

  select source_type into v_source_type from journal_entries where id = p_entry_id;
  if v_source_type is null then
    return;
  end if;
  if v_source_type = 'pos_close' then
    raise exception 'レジ締めの仕訳は取り消せません。レジ画面の「締め直し」を使ってください';
  end if;

  delete from journal_entries where id = p_entry_id;
end;
$$;
