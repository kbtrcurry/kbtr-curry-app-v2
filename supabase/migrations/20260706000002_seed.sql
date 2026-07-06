-- =============================================================
-- 初期データ: 事業セグメント + 勘定科目（青色申告決算書の標準科目準拠）
-- =============================================================

insert into segments (code, name, sort_order) values
  ('magari',  '間借り営業',            1),
  ('event',   'イベント・ケータリング', 2),
  ('note',    'note',                  3),
  ('youtube', 'YouTube',               4),
  ('common',  '共通',                  9);

-- 資産・負債・純資産
insert into accounts (code, name, type, sort_order) values
  ('101', '現金',     'asset',     101),
  ('102', '普通預金', 'asset',     102),
  ('190', '事業主貸', 'asset',     190),
  ('291', '事業主借', 'liability', 291),
  ('301', '元入金',   'equity',    301);

-- 収益
insert into accounts (code, name, type, sort_order) values
  ('401', '売上高', 'revenue', 401),
  ('402', '雑収入', 'revenue', 402);

-- 費用（青色申告決算書の経費科目）
insert into accounts (code, name, type, sort_order) values
  ('501', '仕入高',     'expense', 501),
  ('511', '地代家賃',   'expense', 511), -- 間借りの場所代はここ
  ('512', '水道光熱費', 'expense', 512),
  ('513', '旅費交通費', 'expense', 513),
  ('514', '通信費',     'expense', 514),
  ('515', '広告宣伝費', 'expense', 515),
  ('516', '接待交際費', 'expense', 516),
  ('517', '修繕費',     'expense', 517),
  ('518', '消耗品費',   'expense', 518),
  ('519', '荷造運賃',   'expense', 519),
  ('520', '外注工賃',   'expense', 520),
  ('521', '支払手数料', 'expense', 521), -- プラットフォーム手数料はここ
  ('529', '雑費',       'expense', 529);
