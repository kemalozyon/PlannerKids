# Görsel ve ses varlıklarının lisansları

Uygulamadaki bütün 3D modeller [Kenney](https://www.kenney.nl) paketlerinden alındı ve **CC0 1.0** (kamu malı)
lisanslıdır: kişisel, eğitim ve ticari kullanım serbesttir, kaynak göstermek zorunlu değildir
(https://creativecommons.org/publicdomain/zero/1.0/). Modeller `src/assets/models/` altında; Vite tek dosyalık
demo derlemesinde içlerine gömer.

| Klasör | Paket | Kaynak | Lisans | Not |
|---|---|---|---|---|
| `nature/` | Nature Kit (2.1) | https://kenney.nl/assets/nature-kit | CC0 1.0 | Ağaçlar (her seansın ağacı), çiçek, çit, yol, köprü, heykel, çadır… Yapraklar ve çimen uygulamada boyanır. |
| `furniture/` | Furniture Kit (2.0) | https://kenney.nl/assets/furniture-kit | CC0 1.0 | Oda mobilyası, lamba, saksı, halı, kitaplık, bank. `gltf-transform` ile `dedup` + `prune` + `EXT_meshopt_compression` (15 model, ~72 KB). Kumaş ve lamba renkleri `items.json → tint` ile boyanır. |
| `characters/` | Mini Characters 1 | https://kenney.nl/assets/mini-characters-1 | CC0 1.0 | 12 karakter (kıyafet); yalnızca kullanılan animasyonlar bırakıldı, doku gömüldü, meshopt ile sıkıştırıldı (~52 KB/karakter). |
| `accessories/` | Mini Characters 1 | https://kenney.nl/assets/mini-characters-1 | CC0 1.0 | Gözlük ve güneş gözlüğü (meshopt). Efsane tacı kodla çizilir. |
| `pets/` | Cube Pets | https://kenney.nl/assets/cube-pets | CC0 1.0 | 19 hayvan (ormana gelen canlılar); doku gömüldü, meshopt ile sıkıştırıldı (~60 KB/hayvan). |

Yeni model eklerken: paketi indir, `gltf-transform` ile sıkıştır (`meshopt`), dosyayı ilgili klasöre koy ve bu
tabloya ekle. CC0 olmayan bir model eklenecekse lisansını ve atıf metnini buraya yaz.

## Sesler ve tanıtım

- Uygulama sesleri (`src/lib/sfx.ts`) ve odak modundaki yağmur sesi WebAudio ile kodda üretilir; dosya yok.
- Tanıtım turunun sesleri (`public/demo/*.mp3`) ElevenLabs ile `scripts/gen-demo-audio.mjs` tarafından üretilir.
  ElevenLabs kullanım koşullarına göre üretilen ses, hesabın planına göre ticari kullanıma açıktır; anahtar `.env`'de
  durur, ön yüze girmez.
- Kitap kapakları çalışma anında Open Library'den gelir (https://openlibrary.org, kapaklar
  https://covers.openlibrary.org); depoda saklanmaz.
