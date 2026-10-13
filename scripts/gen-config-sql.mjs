// Ekonomi config'ini SQL migration'ına yazar.
//   npm run config:sql             → bir sonraki numarayla yeni migration (ör. 0014_config.sql)
//   npm run config:sql -- --replace → son *_config.sql dosyasını yeniden yazar (henüz çalıştırılmadıysa)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { renderConfigSql } from './config-sql.mjs';

const root = new URL('..', import.meta.url);
const dir = new URL('supabase/migrations/', root);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const sql = renderConfigSql(read('src/config/economy.json'), read('src/config/items.json'));

const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
let name;
if (process.argv.includes('--replace')) {
  name = files.filter((f) => f.endsWith('_config.sql')).at(-1);
  if (!name) throw new Error('Yeniden yazılacak *_config.sql yok');
} else {
  const next = String(Number(files.at(-1)?.slice(0, 4) ?? 0) + 1).padStart(4, '0');
  name = `${next}_config.sql`;
}
writeFileSync(new URL(name, dir), sql);
console.log(`supabase/migrations/${name} yazıldı. Supabase SQL Editor'de çalıştır.`);
