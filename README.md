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
2. **SQL Editor** → `supabase/migrations/` altındaki dosyaları sırayla (0001, 0002, …) çalıştır (tablolar + RLS + kurallar).
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
    History.tsx    Aylık takvim (ısı haritası + ruh hali), gün detayı, haftalık çubuk grafik, ders dağılımı
    Courses.tsx    Ders ekle / düzenle / sil
    WeekPlan.tsx   Haftalık plan: güne göre ders/dakika, hazır şablonlar, geçen haftayı kopyala
    Rewards.tsx    Ödül hedefleri (çocuğun gördüğü)
    ParentPanel.tsx Aile paneli (PIN): haftalık özet, plan onayı, not, ödüller, oyun ve Elmas, rapor ayarları
    Shop.tsx       Dükkân: 💎/⭐ ile karakter, aksesuar, evcil hayvan, yapı, süs
    Collection.tsx Koleksiyon defteri ve anı albümü
supabase/migrations/0001_init.sql … 0011_config.sql
src/config/economy.json, items.json   Ekonominin tek kaynağı (npm run config:sql → yeni migration)
supabase/functions/daily-report/   Günlük rapor (Edge Function)
```

## Oyunlaştırma: Orman ve para (≈10 yaş için)

Çalışılan her dakika 🪙 1 dakikalık **para**dır. **Her güne tek bir ağaç** dikilir: çocuk o günün parasının
yettiği bitkiyi seçip **o ayın ormanına kendisi diker**. Böylece ormandaki her ağaç bir günü anlatır; ağaca
(ya da Geçmiş takviminde bir güne) dokununca o günün ağacı, dersleri ve "nasıl geçti" notu açılır.
Her ay yeni orman başlar, eski ormanlar ay ay gezilebilir.

- **Fiyat listesi** (`src/lib/forest.ts` → `STAGES`, tek yerde değiştirilebilir):
  Tohum 30 · Çiçek 60 · Küçük ağaç 90 · Büyük ağaç 120 · Dev ağaç 180 dk.
  3 saat çalışılan gün dev ağaç olur.
- **Büyütme:** o gün çalışmaya devam edilirse aynı ağaç farkı ödenerek büyütülür (tohum → çiçek = 30 dk).
- **Bekleyen günler:** ağacı dikilmemiş ya da büyütülebilecek günler ay sonuna kadar "Ağacını bekleyen
  günler"de durur. Ay bitince o ayın ormanına otomatik dikilir/büyütülür (paranın yettiği en büyük evre) —
  emek kaybolmaz.
- **Kurallar sunucuda da korunur:** `forest_trees` tetikleyicisi bir günün harcamasının o günün dakikalarını
  aşmasına izin vermez; `0006_one_tree_per_day.sql` güne ikinci ağaç dikilmesini engeller.
- **Türler:** 8 tür, 3'ü baştan açık; diğerleri en uzun seriyle açılır (3, 5, 7, 10, 14 gün).
- **Yumuşak seri, rozetler, ruh hali (😞…😄), hazır okul dersleri, 20 dk mola hatırlatması.**

### 3D ada

Orman sekmesi, ayın ormanını **izometrik, low-poly bir ada** olarak gösterir (react-three-fiber). Ada döndürülür ve
yakınlaştırılır; ağaca dokununca o günün penceresi açılır.

- **Ada büyür:** toplam çalışma saati arttıkça çiçek tarlası (3 sa), kayalar/mantarlar (8), tavşan (15), gölet (25),
  civciv (35), kamp ateşi (50), tilki (70), arı (100) ve geyik (140) açılır. Hayvanlar adada dolaşır, dokununca dans eder.
- **Gündüz/gece:** ışık gerçek saate göre değişir; akşam ateşböcekleri uçar, kamp ateşi yanar.
- **Büyüme animasyonu:** dikilen/büyütülen ağaç zıplayarak çıkar, etrafına parçacıklar saçılır.
- **Solgun fidan:** sayaç 5 dakikadan sonra iptal edilirse adada solgun bir fidan kalır; aynı gün 10 dk daha çalışılırsa
  yeniden yeşerir (`0007_abandoned_sessions.sql`).
- **Ormanda gezinti:** "🚶 Ormanda gez" düğmesiyle çocuk seçtiği karakterle adada üçüncü şahıs kamerayla yürür
  (dokunmatikte joystick + zıpla, boş yerde sürükleyince kamera döner; klavyede WASD/oklar, Shift koş, boşluk zıpla,
  E etkileşim, Esc çık). Ağacın yanına gidince o günü açar, hayvanları sever (20 sn peşinden gelirler), solgun fidanın
  kaç dakikada yeşereceğini görür, her gün adaya saklanan 8 yıldızı toplar ve dükkândan aldığı yapıları 🔨 ile adasına
  yerleştirir. Seviye atladıkça daha hızlı koşar, çift zıplar, süzülür.

### Güvenilir süre: seanslar sunucuda (`0009_sessions.sql`)

- **Süre sunucunun saatiyle tutulur.** "Başlat" sunucuda bir seans açar; dakikayı sunucu hesaplar ve kaydı o yazar (`source = 'timer'`).
- **Sayaç açıkken** uygulama dakikada bir "buradayım" der. Haber gelmezse (sekme kapandı, ekran kilitlendi, internet gitti) sunucu son haberden 90 sn sonra saymayı bırakır.
- **Sekme değişince** sayaç duraklar, geri gelince "Devam et" çıkar. Oyuna (gezinti) geçince de duraklar.
- **15 dk dokunulmazsa** "Hâlâ çalışıyor musun?" sorulur. 60 sn içinde cevap gelmezse son dokunuştan beri geçen süre sayılmaz.
- **Odak modu** ekranın kararmasını engeller (Wake Lock): kağıttan çalışırken ekran kapanıp sayaç durmasın.
- **Seans sonu:** ders seçimi ve kısa bir "Ne çalıştın?" notu zorunlu.
- **Elle yazılan süre** ("✏️ Süre yaz") kayda ve rapora geçer ama Elmas vermez.

### Elmas, dükkân ve koleksiyon

Değerli şeyler yalnızca ders çalışarak alınır; oyun paranın harcandığı yerdir. **Bütün sayılar `src/config/economy.json` ve `src/config/items.json` dosyalarında.** Değiştirdikten sonra `npm run config:sql` yeni bir migration üretir; onu SQL Editor'de çalıştır.

- **💎 Elmas** tek para birimidir ve yalnızca sayaçla ölçülen çalışmadan kazanılır. Hesabı sunucu yapıp deftere yazar (`0010_economy_v2.sql → economy_sync`); uygulama deftere yazamaz.
  - **Azalan getiri:** ilk saat 10 dk = 1 💎, ikinci saat 20 dk = 1 💎, üçüncü saat 30 dk = 1 💎; sonrası vermez. Günde en çok 12.
  - **Kademeli seri:** 3/7/14/30 gün kademeleri, günde +1…+4 💎. Kaçırılan hafta içi günü seriyi sıfırlamaz, bir kademe düşürür. Hafta sonu bozmaz; seri dondurma bir düşüşü engeller.
  - Öz değerlendirme (puan ve en az 10 harflik not, o gün çalışıldıysa) +1.
  - Planı tamamlanan gün +3. Biten kitap +5, haftada en çok 2 kitap.
  - Ders görevleri +2–5: bugün 30 dk; bu hafta 5 gün, 3 planlı gün, 3 farklı ders, bir kitap.
  - Geçmiş kayıtlar da sayılır.
- **⭐ Yıldız** gezintide toplanır (günde 8). Para değildir, koleksiyonda birikir.
- **Dükkân:** karakterler, aksesuarlar, evcil hayvanlar (yanında gezer), ada yapıları (çadır, köprü, kano, heykel…), süsler ve seri dondurma. Nadirlik: yaygın, nadir, efsanevi.
  - Efsanevi eşyalar yalnızca başarıyla açılır: 30 günlük seri, 10 planlı gün, derslerde altın, Efsane seviyesi. Bir kısmı yalnızca sandıktan çıkar.
- **Haftalık sandık:** haftada 5 gün ve 150 dk çalışınca açılır, içinden sürpriz bir eşya çıkar. Satın alınamaz.
- **Seviye ve ders yetenekleri (Profil):**
  - Toplam saate göre Çırak → Kâşif → Orman Bekçisi → Bahçıvan → Orman Ustası → Orman Bilgesi → Efsane.
  - Her ders bronz/gümüş/altın olur; unvanlar Bilge, Hikâyeci, Mucit, Gezgin… En az çalışılan ders "bunu da büyüt" diye vurgulanır.
- **Koleksiyon defteri:** bütün eşyalar (eksikler gölge gibi) ve geçmiş ayların adalarıyla bir anı albümü.
- **Aile paneli → Oyun ve Elmas:** bakiye, son hareketler, hediye Elmas (1–50), kuralların özeti.
- **Kopya önlemi:** süreyi ve kazancı sunucu hesaplar. Deftere ve sayaç kayıtlarına yalnızca sunucu fonksiyonları yazar; kaydın süresi sonradan değiştirilemez. Bakiyeyi aşan alışveriş, sandık havuzunda olmayan eşya ve defter silme reddedilir.
- Modeller: [Kenney](https://kenney.nl) Nature Kit, Cube Pets ve Mini Characters (CC0); ayrıntı `src/assets/models/LICENSE.md`. WebGL yoksa düz ızgara görünümü kullanılır.

## Planlama, odak modu, ödüller ve aile paneli

`0005_plans_family.sql`'i SQL Editor'de çalıştır (tablolar: `study_plans`, `family_settings`, `parent_notes`, `rewards`).

- **Bugünün planı:** Bugün ekranında ders başına planlanan / çalışılan dakika. "Başlat" / "Devam et" o dersin sayacını,
  kalan dakika kadar bir odak turuyla açar. Planı tamamlanan gün "Planlı Gün" rozetine ve plan ödüllerine sayılır.
- **Haftalık plan** (Bugün › Haftalık planı aç): gün seç, derslere 5'er dakika ayır, konu yaz; hazır şablonlar
  (Okul haftası, Sınav haftası, Hafif hafta, Tatil) ve "Geçen haftayı kopyala". Geçmiş günler değişmez.
- **Odak modu:** tam ekran halka sayaç; tur 25 / 40 dk ya da serbest. Çalıştıkça ortadaki fidan büyür (yalnızca gösterim),
  tur bitince zil çalar; kaydedince 5 dakikalık mola sayacı başlar. İsteğe bağlı yağmur sesi.
- **Ödül hedefleri:** ebeveynin koyduğu gerçek ödüller (toplam dakika, seri, biten kitap, tamamlanan planlı gün).
  Orman parasını harcamaz. Ebeveyn ödülü verince "Kazandıklarım"a geçer.
- **Aile paneli** (Profil › Aile paneli): 4 haneli PIN ile açılır (çocuk kilidi; aynı hesap). Haftalık özet,
  "zordu" uyarısı, plan onayı, çocuğa not (Bugün ekranında 3 gün görünür, çocuk teşekkür/kalp ile yanıtlar),
  ödül ekleme ve günlük rapor ayarları.
- **Alt menü:** Bugün · Orman · Kitaplık · Geçmiş · Profil. Dersler, Ödüller ve Aile paneli Profil'in altında.

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
- **Metni EVREN yazar** ([evren.ssyz.org.tr](https://evren.ssyz.org.tr), Anthropic Messages uyumlu `/v1/messages`; varsayılan model `deepseek-v4-flash`, `REPORT_MODEL` ile değiştirilebilir). Modeller önce düşündüğü için token bütçesi 4000; düşükse JSON yarım kalır ve yedek metne düşülür. Rakamlar ve tablo
  şablondan gelir; LLM yalnızca özet, öne çıkanlar ve öneriyi yazar, verilmeyen bilgiyi uydurmaması,
  çocuğu yargılamaması ve çocuğun notundaki talimatları uygulamaması istenir.
- **LLM'e ulaşılamazsa** rapor yine gider: kurallarla yazılmış yedek metin kullanılır.
- **E-posta:** Resend API. Gönderim başarısız olursa kayıt silinir, tekrar denenebilir.
- Kod: `supabase/functions/_shared/report.ts` (girdi → olgular → LLM komutu → e-posta HTML'i; uygulamayla ortak),
  `supabase/functions/daily-report/core.ts` (gönderim mantığı, test edilebilir), `index.ts` (Supabase bağlantısı).
- **Demo modunda** e-posta ve LLM yoktur; "Bugünü bitirdim" aynı şablonla yedek metinli bir önizleme gösterir.

### Kurulum

1. `0004_reports.sql`'i çalıştır. Ebeveyn ayarlarını uygulamada **Profil → Aile paneli**'nden gir.
2. [resend.com](https://resend.com)'da hesap aç, gönderen alan adını doğrula, API anahtarı al.
3. Secret'ları gir ve fonksiyonu deploy et:
   ```bash
   supabase secrets set EVREN_API_KEY=... RESEND_API_KEY=... \
     REPORT_FROM="Çalışma Takip <rapor@alanadin.com>" CRON_SECRET=$(openssl rand -hex 24)
   supabase functions deploy daily-report     # config.toml: verify_jwt = false (kendi auth'unu yapar)
   ```
4. `0004_reports.sql`'in sonundaki yorum satırındaki `cron.schedule` bloğunu proje ref'i ve
   CRON_SECRET ile doldurup SQL Editor'de bir kez çalıştır (saatte bir tetikler; her kullanıcının
   saatine bakar).

**Gizlilik:** Raporu hazırlarken o günün kayıtları ve çocuğun "nasıl geçti" notu EVREN'e (Savunma Sanayii Başkanlığı'nın yapay zekâ platformu) gönderilir.
Uygulamaya ebeveynin hesabıyla girildiği ve ayarlarda bu açıkça yazdığı için onay ebeveyndedir; rapor kapatılabilir.

## Notlar

- Sayaç sayfa yenilense, sekme uyusa veya başka sekmede açılsa da doğru süreyi gösterir.
  Durdurulduğunda süre düzenlenebilir bir "Oturumu kaydet" kartına düşer.
- Çalışma kaydı, sayacın **başladığı** günün tarihine yazılır (gece yarısını geçen oturumlar için).
- Bir ders silinince ona ait çalışma kayıtları da silinir (cascade); görevlerdeki ders etiketi boşalır.
- `daily_reflections` (user_id, date) üzerinde unique; kayıt upsert ile yapılır.
