# Görsel ve ses varlıklarının lisansları

Uygulamadaki bütün hazır 3D modeller [Kenney](https://www.kenney.nl) paketlerinden alındı ve **CC0 1.0** (kamu malı)
lisanslıdır: kişisel, eğitim ve ticari kullanım serbesttir, kaynak göstermek zorunlu değildir
(https://creativecommons.org/publicdomain/zero/1.0/). Modeller `src/assets/models/` altında; Vite tek dosyalık
demo derlemesinde içlerine gömer.

| Klasör | Paket | Kaynak | Lisans | Not |
|---|---|---|---|---|
| `nature/` | Nature Kit (2.1) | https://kenney.nl/assets/nature-kit | CC0 1.0 | 64 model: günlük ağaçların 14 türü (yaprak/gövde renkleri `economy.json → world.species` ile boyanır), harita manzaraları, bahçe süsleri (çit, yol, çiçek, bostan, kaya, kütük, kamp, heykel, kano…). `gltf-transform` ile `dedup` + `prune` + `EXT_meshopt_compression`. |
| `furniture/` | Furniture Kit (2.0) | https://kenney.nl/assets/furniture-kit | CC0 1.0 | 81 model: oturma, masa, yatak odası, mutfak, banyo, elektronik, ışık, bitki, halı ve duvar eşyaları (meshopt, ~660 KB toplam). Kumaş ve lamba renkleri `items.json → tint` ile boyanır. |
| `pets/` | Cube Pets | https://kenney.nl/assets/cube-pets | CC0 1.0 | 19 hayvan (bahçelere gelen canlılar); doku gömüldü, meshopt ile sıkıştırıldı (~60 KB/hayvan). |

Kodla çizilenler (model dosyası yok): parça parça avatar ve kıyafetleri (`components/avatar/AvatarModel.tsx`),
posterler, tablolar, duvar saati, ışık zinciri ve zemin/duvar desenleri (`components/world3d/art.ts`), kitaplık ve
kitap sırtları (`components/world3d/Books.tsx`), evler ve haritaların dağları.

Yeni model eklerken: paketi indir, `gltf-transform` ile sıkıştır (`meshopt`), dosyayı ilgili klasöre koy ve bu
tabloya ekle. CC0 olmayan bir model eklenecekse lisansını ve atıf metnini buraya yaz.

## Sesler ve tanıtım

- Uygulama sesleri (`src/lib/sfx.ts`) ve odak modundaki yağmur sesi WebAudio ile kodda üretilir; dosya yok.
- Tanıtım turunun sesleri (`public/demo/*.mp3`) ElevenLabs ile `scripts/gen-demo-audio.mjs` tarafından üretilir.
  ElevenLabs kullanım koşullarına göre üretilen ses, hesabın planına göre ticari kullanıma açıktır; anahtar `.env`'de
  durur, ön yüze girmez.
- Kitap kapakları çalışma anında Open Library'den gelir (https://openlibrary.org, kapaklar
  https://covers.openlibrary.org); depoda saklanmaz.
