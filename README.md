# Çalışma Takip — MVP

"Bugün ne çalıştım, ne kadar çalıştım, gün nasıl geçti?"
React (Vite) + TypeScript + Supabase (Postgres, Auth, RLS). Ayrı backend yok.

## Hızlı başlangıç (demo modu)

```bash
npm install
npm run dev
```

`.env` yoksa uygulama **demo modunda** açılır: veriler localStorage'da tutulur, örnek veri yüklenir.
Tek dosyalık demo derlemesi: `npm run build:demo` → `dist-demo/index.html`. İlk açılışta "Demoyu başlat 🔊" ile
2 dakikalık sesli/yazılı bir tanıtım turu başlar (Profil → Tanıtımı izle ile yeniden açılır).

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
    SessionContext.tsx  Çalışma seansı (süre sunucuda): buradayım, sekme/hareketsizlikte duraklatma
    world.ts       Dünya: karo ızgarası, yerleştirme kuralları, A*, araziler, her seansın ağacı, bölgeler
    date.ts        Yerel tarih yardımcıları (YYYY-MM-DD, hafta pazartesi başlar)
  components/world3d/  3D dünya (react-three-fiber): oda, bahçe+orman, avatar, eşyalar, yerleştirme
  components/Tour.tsx  Tanıtım turu (driver.js + kelime kelime altyazı)
  pages/
    Today.tsx      Sayaç / elle giriş, bugünkü kayıtlar, görevler, günlük değerlendirme
    World.tsx      Dünyam: oda, kütüphane odası, bahçe ve aylık orman bölgeleri; düzenleme modu
    Library.tsx    Kitaplığım: Open Library araması, raf, şu an okuduklarım, okunacaklar, okuma hedefleri
    History.tsx    Aylık takvim (ısı haritası + ruh hali), gün detayı, haftalık çubuk grafik, ders dağılımı
    Courses.tsx    Ders ekle / düzenle / sil
    WeekPlan.tsx   Haftalık plan: güne göre ders/dakika, hazır şablonlar, geçen haftayı kopyala
    Rewards.tsx    Ödül hedefleri (çocuğun gördüğü)
    ParentPanel.tsx Aile paneli (PIN): haftalık özet, plan onayı, not, ödüller, oyun ve Elmas, rapor ayarları
    Shop.tsx       Dükkân: 💎 ile mobilya, zemin, duvar, bitki, ışık, dış mekân süsü, kıyafet
    Collection.tsx Koleksiyon defteri ve ormanın bölgeleri
  demo/script.json  Tanıtım turunun sahneleri
supabase/migrations/0001_init.sql … 0014_config.sql
public/demo/       Tanıtım sesleri ve kelime zamanları (npm run demo:audio, ElevenLabs)
ASSETS_LICENSES.md 3D modellerin lisansları (Kenney, CC0)
src/config/economy.json, items.json   Ekonominin tek kaynağı (npm run config:sql → yeni migration)
supabase/functions/daily-report/   Günlük rapor (Edge Function)
```

## Oyunlaştırma: çalıştıkça büyüyen dünya (10–14 yaş)

Ana döngü: **çalış → ağaç dik → dünya büyür → kazandığın Elmasla evini ve bahçeni süsle.** Dünyanın büyüklüğü
yalnızca çalışmayla, güzelliği Elmasla artar; arazi satın alınamaz. Tek oyunculu; oda ve orman verisi `user_id`'ye
bağlı (ileride salt okunur ziyaret eklenebilir).

### Dünyam: oda, bahçe ve orman (aynı 3D ızgara)

Alt menüdeki **Dünyam** sekmesi, react-three-fiber ile çizilen low-poly bir dünya: izometrik hisli ortografik kamera,
döndürme ve yakınlaştırma serbest, kaydırma alanla sınırlı. Sahne yalnızca bir şey değişince çizilir
(`frameloop="demand"`); tekrar eden ağaçlar türe göre tek çizimde (instancing); telefonda gölgeler varsayılan kapalı (🌗).

- **Oda (8×8 karo):** zemin ızgarası yalnızca düzenlerken görünür. Bir karoya dokununca karakter oraya **A\* ile yol
  bularak** yürür. Kapıdan bahçeye çıkılır (kısa geçiş); 36 kitap bitince odada **kütüphane odasına** açılan yeni bir kapı belirir.
- **Düzenle (✏️):** alttaki envanterden eşya seç ya da odadaki eşyayı sürükle; karoya oturur, **yeşil** konabilir,
  **kırmızı** konamaz. Döndür, envantere geri koy, zemin ve duvar kaplamasını değiştir, Kaydet. Yerleşim Postgres'te
  jsonb olarak durur (`user_spaces`) ve **sunucuda doğrulanır**: alan sınırı, kapı/ev/su gibi sabit karolar, çakışma
  (halı ile mobilya ayrı katman) ve envanter (`0012_spaces.sql → save_space`).
- **Bahçe:** evin önü; toplam çalışmayla genişler: Açıklık → **Dere** (5 sa) → **Tepe** (15) → **Göl** (30) →
  **Köprü** (60) → **Sihirli koru** (100). Dış mekân süsleri buraya yerleştirilir.
- **Orman:** **her sayaç seansı bir ağaç**; türü süreye göre (🌱 fidan, 🌿 15 dk çalı, 🌳 30 genç ağaç, 🌲 45 çam,
  🌳 60 meşe, 🌲 90 dev ağaç). Yarıda bırakılan uzun seans **kuru ağaç** olur. Ağacın yeri seans kimliğinden tohumlanır;
  orman her açılışta aynı görünür. **Her ay yeni bir bölge** açılır; geçmiş aylar kalıcıdır ve gezilebilir
  (Bölgeler). Yeni ağaç bir kez elastik büyüyerek ve yaprak parçacıklarıyla belirir.
- **Canlılar:** orman büyüdükçe kendiliğinden gelir (kelebek, kuş, tavşan, civciv, arı, tilki, geyik); satın alınamaz.
  Kedi, köpek gibi dostlar da ağaç sayısıyla açılır ve yanına alınabilir.
- **🚶 Yakından gez:** bahçede ve ormanda üçüncü şahıs kamerayla yürü (joystick / WASD), ağaçların yanına gidip seansı
  gör, her gün saklanan 8 yıldızı topla. Gezintiye geçince çalışma sayacı duraklar.
- Modeller Kenney Nature Kit, Furniture Kit, Mini Characters ve Cube Pets (CC0); ayrıntı `ASSETS_LICENSES.md`.
  WebGL yoksa ağaçlar aylara göre düz liste olarak görünür.

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
- **Dükkân:** mobilya, zemin, duvar, bitki, ışık, dış mekân dekoru ve kıyafet (karakter, aksesuar); ~35 eşya. Satın alma
  tek işlemde: bakiye düşer, eşya envantere eklenir (`owned_items` tetikleyicisi). Nadirlik: yaygın, nadir, efsanevi.
  - Nadir eşyalar ticaretle değil başarıyla açılır: 100 saatte "Bilge'nin yıldız lambası", 30 günlük seri, 10 planlı gün, derslerde altın, Efsane seviyesi. Bir kısmı yalnızca sandıktan çıkar.
- **Haftalık sandık:** haftada 5 gün ve 150 dk çalışınca açılır, içinden sürpriz bir eşya çıkar. Satın alınamaz.
- **Seviye ve ders yetenekleri (Profil):**
  - Toplam saate göre Çırak → Kâşif → Orman Bekçisi → Bahçıvan → Orman Ustası → Orman Bilgesi → Efsane.
  - Her ders bronz/gümüş/altın olur; unvanlar Bilge, Hikâyeci, Mucit, Gezgin… En az çalışılan ders "bunu da büyüt" diye vurgulanır.
- **Koleksiyon defteri:** bütün eşyalar (eksikler gölge gibi) ve ormanın aylık bölgeleri.
- **Aile paneli → Oyun ve Elmas:** bakiye, son hareketler, hediye Elmas (1–50), kuralların özeti.
- **Kopya önlemi:** süreyi ve kazancı sunucu hesaplar. Deftere ve sayaç kayıtlarına yalnızca sunucu fonksiyonları yazar; kaydın süresi sonradan değiştirilemez. Bakiyeyi aşan alışveriş, sandık havuzunda olmayan eşya ve defter silme reddedilir.
- Modeller: [Kenney](https://kenney.nl) Nature Kit, Cube Pets ve Mini Characters (CC0); ayrıntı `src/assets/models/LICENSE.md`. WebGL yoksa düz ızgara görünümü kullanılır.

## Planlama, odak modu, ödüller ve aile paneli

`0005_plans_family.sql`'i SQL Editor'de çalıştır (tablolar: `study_plans`, `family_settings`, `parent_notes`, `rewards`).

- **Bugünün planı:** Bugün ekranında ders başına planlanan / çalışılan dakika. "Başlat" / "Devam et" o dersin sayacını,
  kalan dakika kadar bir odak turuyla açar. Planı tamamlanan gün "Planlı Gün" rozetine ve plan ödüllerine sayılır.
- **Haftalık plan** (Bugün › Haftalık planı aç): gün seç, derslere 5'er dakika ayır, konu yaz; hazır şablonlar
  (Okul haftası, Sınav haftası, Hafif hafta, Tatil) ve "Geçen haftayı kopyala". Geçmiş günler değişmez.
- **Odak modu:** tam ekran halka sayaç; tur 25 / 40 dk ya da serbest. Seans uzadıkça ortadaki ağaç türü değişir (bu seansın ağacı),
  tur bitince zil çalar; kaydedince 5 dakikalık mola sayacı başlar. İsteğe bağlı yağmur sesi.
- **Ödül hedefleri:** ebeveynin koyduğu gerçek ödüller (toplam dakika, seri, biten kitap, tamamlanan planlı gün).
  Elmas harcamaz. Ebeveyn ödülü verince "Kazandıklarım"a geçer.
- **Aile paneli** (Profil › Aile paneli): 4 haneli PIN ile açılır (çocuk kilidi; aynı hesap). Haftalık özet,
  "zordu" uyarısı, plan onayı, çocuğa not (Bugün ekranında 3 gün görünür, çocuk teşekkür/kalp ile yanıtlar),
  ödül ekleme ve günlük rapor ayarları.
- **Alt menü:** Bugün · Dünyam · Kitaplık · Geçmiş · Profil. Dersler, Ödüller, Aile paneli ve Tanıtım Profil'in altında.

## Okuma ve kitaplık

Okuma ağaç vermez; kendi kitaplığını oluşturur ve kitaplar odadaki **kitaplığın raflarına** dizilir.

- **Kitap ekle:** ad ya da ISBN ile **Open Library'de ara**; kapak, yazar ve sayfa sayısı gelir. Bulunamazsa ad elle
  yazılır, kitap renkli sırtla görünür. Okuyacağım / okuyorum / bitirdim; bitirdiğin kitapta **"En sevdiğin kısım neydi?"** zorunlu.
- **"📖 Okudum":** kaç dakika + kaçıncı sayfaya gelindi → okunan sayfa hesaplanır, ilerleme çubuğu dolar.
  Son sayfaya gelince bitirme akışı açılır (sayfa sayısı bilinmeyen kitaplar kitap kartındaki "Bitirdim" ile).
- **Bitirince:** en sevdiğin kısım, 1–5 yıldız, en sevdiğin karakter, bir cümleyle anlat → kutlama, kitap rafa dizilir.
- **Odadaki kitaplık:** dokununca raflar açılır (rafta 12 kitap, dolunca yeni raf); kitaba dokununca kapağı ve en sevdiğin
  kısım. 36 kitapta kütüphane odası açılır (`0013_books_shelf.sql`).
- **Hedefler:** aylık kitap hedefi (varsayılan 2), günlük sayfa hedefi (15), ayrı okuma serisi
  (ders serisiyle aynı yumuşak kurallar). Hedefler Kitaplığım → "Hedefler"den değişir.
- **Raf:** kitap kalınlığı sırtın eni/boyunda görünür; türe göre filtrelenir; dokununca kitap kartı açılır.

Yeni tablolar: `books`, `reading_logs`, `book_trees`, `reading_goals` → `supabase/migrations/0003_reading.sql`.

## Günlük ebeveyn raporu (LLM + e-posta)

Çocuk "🌙 Bugünü bitirdim"e bastığında, basmazsa her akşam seçilen saatte (varsayılan 21:00)
günün raporu ebeveynin e-postasına gider. **Günde en fazla bir rapor** (`daily_reports` unique).

- **İçerik:** ders süreleri ve dağılımı, önceki günlerle kıyas, son 7 günde çalışılan gün,
  yapılacaklar, ormana dikilen ağaçlar (her seans bir ağaç), okuma (sayfa, kitap, biten kitap), ruh hali ve çocuğun notu,
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

## Tanıtım turu (sesli ve yazılı)

- İlk girişte Bugün ekranında **"Demoyu başlat 🔊"** / **"Sessiz izle"**. Tur her sahnede ilgili sayfayı açar, ilgili
  ögeyi öne çıkarır (driver.js) ve altyazıyı **kelime kelime** vurgular. Geri, duraklat, ileri, sessize alma; Esc kapatır.
- Sesler önceden üretilir, canlı TTS yok: `npm run demo:audio` (`scripts/gen-demo-audio.mjs`) her sahne için
  ElevenLabs'tan ses ve kelime zamanlarını alıp `public/demo/<sahne>.mp3` ve `.json` yazar. `ELEVENLABS_API_KEY`
  `.env`'de durur ve ön yüze girmez. Ses dosyası yoksa tur kendiliğinden yazılı moda geçer.
- Sahneler ve metinler `src/demo/script.json`'da; metni değiştirince `npm run demo:audio -- --force`.

## Notlar

- Sayaç sunucuda tutulur: sayfa yenilense de açık seans sunucudan gelir; sekme değişince duraklar.
  "Bitirdim"de süre durur, ders ve "Ne çalıştın?" notu sorulur; süre elle değiştirilemez.
- Çalışma kaydı, sayacın **başladığı** günün tarihine yazılır (gece yarısını geçen oturumlar için).
- Bir ders silinince ona ait çalışma kayıtları da silinir (cascade); görevlerdeki ders etiketi boşalır.
- `daily_reflections` (user_id, date) üzerinde unique; kayıt upsert ile yapılır.
