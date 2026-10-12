# Çalışma Takip — MVP

"Bugün ne çalıştım, ne kadar çalıştım, gün nasıl geçti?"
React (Vite) + TypeScript + Supabase (Postgres, Auth, RLS). Ayrı backend yok.

## Hızlı başlangıç (demo modu)

```bash
npm install
npm run dev
```

`.env` yoksa uygulama **demo modunda** açılır: veriler localStorage'da tutulur, örnek veri yüklenir.
Tek dosyalık demo derlemesi: `npm run build:demo` → `dist-demo/index.html`.

## Supabase'e bağlama

1. supabase.com'da proje oluştur.
2. **SQL Editor** → `supabase/migrations/0001_init.sql` içeriğini çalıştır (tablolar + RLS).
3. **Authentication → Providers → Google**'ı aç:
   - Google Cloud Console'da OAuth Client (Web) oluştur.
   - Authorized redirect URI: `https://<proje-ref>.supabase.co/auth/v1/callback`
   - Client ID / Secret'ı Supabase'e gir.
4. **Authentication → URL Configuration**: Site URL ve Redirect URLs'e `http://localhost:5173`
   (ve yayınlandıktan sonra prod adresini) ekle.
5. `.env.example` → `.env` olarak kopyala, `Project Settings → API`'den URL ve anon key'i yaz.
6. `npm run dev`

## Yapı

```
src/
  lib/
    types.ts       Veri tipleri + Api arayüzü
    api.ts         supabaseApi (gerçek) ve localApi (demo) — aynı arayüz
    useTimer.ts    Sayaç: başlangıç timestamp'i localStorage'da, süre farktan hesaplanır
    date.ts        Yerel tarih yardımcıları (YYYY-MM-DD, hafta pazartesi başlar)
  pages/
    Today.tsx      Sayaç / elle giriş, bugünkü kayıtlar, görevler, günlük değerlendirme
    Forest.tsx     Aylık orman + kitap parseli, dikme/taşıma, tür seçici, gün detayı, rozetler
    Library.tsx    Kitaplığım: raf, şu an okuduklarım, okunacaklar, okuma hedefleri
    History.tsx    Son 28 gün listesi + haftalık ders dağılımı (SVG halka grafik)
    Courses.tsx    Ders ekle / düzenle / sil
supabase/migrations/0001_init.sql … 0004_reports.sql
supabase/functions/daily-report/   Günlük rapor (Edge Function)
```

## Oyunlaştırma: Orman ve para (≈10 yaş için)

Çalışılan her dakika 🪙 1 dakikalık **para**dır. Çocuk o günün parasıyla bitki satın alıp
**o ayın ormanına kendisi diker**. Her ay yeni orman başlar, eski ormanlar ay ay gezilebilir.

- **Fiyat listesi** (`src/lib/forest.ts` → `STAGES`, tek yerde değiştirilebilir):
  Tohum 30 · Çiçek 60 · Küçük ağaç 90 · Büyük ağaç 120 · Dev ağaç 180 dk.
  3 saatle bir dev ağaç *ya da* iki küçük ağaç *ya da* 6 tohum… seçim çocuğun.
- **Cüzdan günlüktür:** her günün parası o güne aittir; harcanmayan kısım ay sonuna kadar
  "Harcanmayı bekleyen cüzdanlar"da durur. Ay bitince kalanlar o ayın ormanına otomatik harcanır
  (hep alınabilecek en büyük bitki) — emek kaybolmaz.
- **Büyütme:** dikili bir bitki, o günün cüzdanından farkı ödenerek büyütülür (tohum → çiçek = 30 dk).
- **Bütçe sunucuda da korunur:** `forest_trees` tetikleyicisi bir günün harcamasının o günün dakikalarını
  aşmasına izin vermez.
- **Türler:** 8 tür, 3'ü baştan açık; diğerleri en uzun seriyle açılır (3, 5, 7, 10, 14 gün).
- **Yumuşak seri, rozetler, ruh hali (😞…😄), hazır okul dersleri, 20 dk mola hatırlatması.**

## Okuma ve kitaplık

Okuma **ormandaki günlük bitkiye sayılmaz**; kendi kitaplığını ve kitap parselini oluşturur.

- **Kitap ekle:** ad, yazar, sayfa sayısı, tür, kim önerdi, sırt rengi. Okunacaklar listesine ya da doğrudan "okuyorum"a.
- **"📖 Okudum":** kaç dakika + kaçıncı sayfaya gelindi → okunan sayfa hesaplanır, ilerleme çubuğu dolar.
  Son sayfaya gelince bitirme akışı açılır (sayfa sayısı bilinmeyen kitaplar kitap kartındaki "Bitirdim" ile).
- **Bitirince:** 1–5 yıldız, "en sevdiğin karakter", "bir cümleyle anlat" → kutlama, kitap rafa dizilir.
- **Kitap parseli:** ormanda her ay 4 yerlik ayrı parsel (dolarsa 4'er büyür). Biten her kitap için bir
  **kitap ağacı** dikilir: gövdesi üst üste kitaplar, tacı altın sarısı, yaprakları açık kitaplar.
  Boyu sayfa sayısına göre: <100 küçük, 100–199 orta, 200+ büyük. Geçmiş aylarda dikilmeyenler otomatik dikilir.
- **Hedefler:** aylık kitap hedefi (varsayılan 2), günlük sayfa hedefi (15), ayrı okuma serisi
  (ders serisiyle aynı yumuşak kurallar). Hedefler Kitaplığım → "Hedefler"den değişir.
- **Raf:** kitap kalınlığı sırtın eni/boyunda görünür; türe göre filtrelenir; dokununca kitap kartı açılır.

Yeni tablolar: `books`, `reading_logs`, `book_trees`, `reading_goals` → `supabase/migrations/0003_reading.sql`.

## Günlük ebeveyn raporu (LLM + e-posta)

Çocuk "🌙 Bugünü bitirdim"e bastığında, basmazsa her akşam seçilen saatte (varsayılan 21:00)
günün raporu ebeveynin e-postasına gider. **Günde en fazla bir rapor** (`daily_reports` unique).

- **İçerik:** ders süreleri ve dağılımı, önceki günlerle kıyas, son 7 günde çalışılan gün,
  yapılacaklar, ormana dikilenler, okuma (sayfa, kitap, biten kitap), ruh hali ve çocuğun notu,
  ebeveyne bir öneri.
- **Metni Claude yazar** (`claude-sonnet-5-5`, `REPORT_MODEL` ile değiştirilebilir). Rakamlar ve tablo
  şablondan gelir; LLM yalnızca özet, öne çıkanlar ve öneriyi yazar, verilmeyen bilgiyi uydurmaması,
  çocuğu yargılamaması ve çocuğun notundaki talimatları uygulamaması istenir.
- **LLM'e ulaşılamazsa** rapor yine gider: kurallarla yazılmış yedek metin kullanılır.
- **E-posta:** Resend API. Gönderim başarısız olursa kayıt silinir, tekrar denenebilir.
- Kod: `supabase/functions/_shared/report.ts` (girdi → olgular → LLM komutu → e-posta HTML'i; uygulamayla ortak),
  `supabase/functions/daily-report/core.ts` (gönderim mantığı, test edilebilir), `index.ts` (Supabase bağlantısı).
- **Demo modunda** e-posta ve LLM yoktur; "Bugünü bitirdim" aynı şablonla yedek metinli bir önizleme gösterir.

### Kurulum

1. `0004_reports.sql`'i çalıştır. Ebeveyn ayarlarını uygulamada **Dersler → Ebeveyn raporu**'ndan gir.
2. [resend.com](https://resend.com)'da hesap aç, gönderen alan adını doğrula, API anahtarı al.
3. Secret'ları gir ve fonksiyonu deploy et:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=... RESEND_API_KEY=... \
     REPORT_FROM="Çalışma Takip <rapor@alanadin.com>" CRON_SECRET=$(openssl rand -hex 24)
   supabase functions deploy daily-report     # config.toml: verify_jwt = false (kendi auth'unu yapar)
   ```
4. `0004_reports.sql`'in sonundaki yorum satırındaki `cron.schedule` bloğunu proje ref'i ve
   CRON_SECRET ile doldurup SQL Editor'de bir kez çalıştır (saatte bir tetikler; her kullanıcının
   saatine bakar).

**Gizlilik:** Raporu hazırlarken o günün kayıtları ve çocuğun "nasıl geçti" notu Anthropic API'sine gönderilir.
Uygulamaya ebeveynin hesabıyla girildiği ve ayarlarda bu açıkça yazdığı için onay ebeveyndedir; rapor kapatılabilir.

## Notlar

- Sayaç sayfa yenilense, sekme uyusa veya başka sekmede açılsa da doğru süreyi gösterir.
  Durdurulduğunda süre düzenlenebilir bir "Oturumu kaydet" kartına düşer.
- Çalışma kaydı, sayacın **başladığı** günün tarihine yazılır (gece yarısını geçen oturumlar için).
- Bir ders silinince ona ait çalışma kayıtları da silinir (cascade); görevlerdeki ders etiketi boşalır.
- `daily_reflections` (user_id, date) üzerinde unique; kayıt upsert ile yapılır.
