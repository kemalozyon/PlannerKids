// src/config/economy.json + items.json → economy_config ve item_defs tablolarını dolduran SQL.
// `npm run config:sql` (scripts/gen-config-sql.mjs) bunu bir migration dosyasına yazar; logic.test.ts son
// üretilen migration'ın bugünkü JSON'larla aynı olduğunu bu fonksiyonla denetler.

const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== '$comment'));
const q = (v) => (v == null ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

/** Sandıktan çıkabilen eşyalar (src/lib/economy.ts → inChestPool ile aynı) */
export const inChest = (d) => !!d.chest || (d.category === 'yapi' && d.price != null);

export function renderConfigSql(economy, items) {
  const cfg = JSON.stringify(strip(economy));
  const defs = items.items;
  const rows = defs.map(
    (d) =>
      `  (${q(d.id)}, ${q(d.category)}, ${q(d.price ?? null)}, ${q(!!d.repeat)}, ${q(inChest(d))}, ${q(d.w ?? 1)}, ${q(d.h ?? 1)}, ` +
      `'{${(d.rotations ?? [0]).join(',')}}', ${q(d.placement ?? null)}, $d$${JSON.stringify(d)}$d$)`,
  );
  return `-- Üretildi: npm run config:sql (src/config/economy.json ve src/config/items.json). Elle değiştirme;
-- JSON'ları düzenleyip komutu yeniden çalıştır, sonra bu dosyayı Supabase SQL Editor'de çalıştır.

insert into public.economy_config (id, value, updated_at)
values (1, $cfg$${cfg}$cfg$::jsonb, now())
on conflict (id) do update set value = excluded.value, updated_at = now();

delete from public.item_defs where id not in (${defs.map((d) => q(d.id)).join(', ')});

insert into public.item_defs (id, category, price, repeat, in_chest, w, h, rotations, placement, def) values
${rows.join(',\n')}
on conflict (id) do update set
  category = excluded.category, price = excluded.price, repeat = excluded.repeat, in_chest = excluded.in_chest,
  w = excluded.w, h = excluded.h, rotations = excluded.rotations, placement = excluded.placement, def = excluded.def;
`;
}
