-- Günde tek ağaç: bir günün parası o günün tek ağacına gider; ağaç sonradan farkı ödenerek büyütülür.
-- Böylece ormandaki her ağaç tek bir günü anlatır.

-- Eski verilerde aynı güne birden çok bitki olabilir: en büyüğü (eşitse ilk dikileni) kalır, diğerleri silinir.
-- Açığa çıkan para kaybolmaz: kalan ağaç ormanda o günün parasıyla büyütülebilir
-- (geçmiş aylardakileri uygulama açılışta kendisi büyütür).
delete from public.forest_trees t
using public.forest_trees k
where t.user_id = k.user_id
  and t.date = k.date
  and t.id <> k.id
  and (k.stage > t.stage or (k.stage = t.stage and (k.created_at, k.id) < (t.created_at, t.id)));

create unique index if not exists forest_trees_user_date_key on public.forest_trees (user_id, date);
