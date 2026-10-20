# Çalışma Takip — MVP

"Bugün ne çalıştım, ne kadar çalıştım, gün nasıl geçti?"
React (Vite) + TypeScript + Supabase (Postgres, Auth, RLS). Ayrı backend yok.

## Hızlı başlangıç (demo modu)

```bash
npm install
npm run dev
```

`.env` yoksa uygulama **demo modunda** açılır: veriler localStorage'da tutulur, örnek veri yüklenir.
Tek dosyalık demo derlemesi: `npm run build:demo` → `dist-demo/index.html`. Railway'de
gerçek uygulama yayınlanır: `railway.json` (Railpack, `npm run build` → `dist/`, Caddy ile sunulur). Railway'in
Variables sekmesinde `VITE_SUPABASE_URL` ve `VITE_SUPABASE_ANON_KEY` olmalı (derleme sırasında okunur); yoksa
yayın demo modunda açılır. Railway adresi Supabase → Authentication → URL Configuration'a eklenmeli. İlk açılışta "Demoyu başlat 🔊" ile
5 dakikalık, 28 sahnelik sesli/yazılı bir tanıtım turu başlar (Profil → Tanıtımı izle ile yeniden açılır). Sesler
derlemeye gömülür; tek dosyalık demo `file://` ile açılınca da sesli oynar.

## Supabase'e bağlama

1. supabase.com'da proje oluştur.
2. **SQL Editor** → `supabase/migrations/` altındaki dosyaları sırayla (0001, 0002, …) çalıştır (tablolar + RLS + kurallar).
3. **Authentication → Providers → Google**'ı aç:
   - Google Cloud Console'da OAuth Client (Web) oluştur.
   - Authorized redirect URI: `https://<proje-ref>.supabase.co/auth/v1/callback`
   - Client ID / Secret'ı Supabase'e gir.
4. **Authentication → URL Configuration**: Site URL ve Redirect URLs'e `http://localhost:5173`
   (ve yayınlandıktan sonra prod adresini) ekle.
5. Yalnızca mevcut hesap(lar) kullanacaksa **Authentication → Sign In / Providers → Allow new users to sign up**'ı kapat:
   yeni hesap (e-posta ya da Google) sunucuda reddedilir, giriş ekranındaki "Hesap oluştur" sekmesi kendiliğinden gizlenir.
   Panelden "Add user" ile hesap eklemek çalışmaya devam eder. Yeniden açmak için aynı anahtarı aç; kod değişikliği gerekmez.
6. `.env.example` → `.env` olarak kopyala, `Project Settings → API`'den URL ve anon key'i yaz.
7. `npm run dev`

## Yapı

```
src/
  lib/
    types.ts       Veri tipleri + Api arayüzü
    api.ts         supabaseApi (gerçek) ve localApi (demo) — aynı arayüz
    SessionContext.tsx  Çalışma seansı (süre sunucuda): buradayım, sekme/hareketsizlikte duraklatma
    world.ts       Dünya: arazi aşamaları, karo ızgarası, yerleştirme kuralları (masa üstü, duvar), A*, eşya kullanma, günlük ağaçlar
    worldPlan.ts   Tek oda planı (Habbo gibi): seçilen oda, kapının götürdüğü oda, ay bahçesi planı
    avatar.ts      Parça parça avatar: görünüş, parçalar, renkler, sahiplik
    date.ts        Yerel tarih yardımcıları (YYYY-MM-DD, hafta pazartesi başlar)
  components/world3d/  3D (react-three-fiber): seçilen oda ya da teras (WorldScene), Bahçem'in ay bahçesi (GardenView), eşyalar
  components/avatar/   Kodla çizilen avatar, önizleme ve karakter düzenleyici
  components/Tour.tsx  Tanıtım turu (driver.js + kelime kelime altyazı)
  pages/
    Today.tsx      Sayaç / elle giriş, bugünkü kayıtlar, görevler, günlük değerlendirme
    World.tsx      Dünyam: Habbo gibi tek tek odalar, oda şeridi, alttaki panel (eşya, Envanter, Dükkân, Oda)
    Garden.tsx     Bahçem: her gün bir ağaç; ağaca dokunup o günün Elmasını al
    Library.tsx    Kitaplığım: Open Library araması, raf, şu an okuduklarım, okunacaklar, okuma hedefleri
    History.tsx    Aylık takvim (ısı haritası + ruh hali), gün detayı, haftalık çubuk grafik, ders dağılımı
    Courses.tsx    Ders ekle / düzenle / sil
    WeekPlan.tsx   Haftalık plan: güne göre ders/dakika, hazır şablonlar, geçen haftayı kopyala
    Rewards.tsx    Ödül hedefleri (çocuğun gördüğü)
    ParentPanel.tsx Aile paneli (PIN): haftalık özet, plan onayı, not, ödüller, oyun ve Elmas, rapor ayarları
    Shop.tsx       Dükkân: 💎 ile mobilya, ışık, bitki, halı, duvar süsü, kaplama, dış mekân, kıyafet (alt başlıklarla)
    Collection.tsx Koleksiyon defteri ve ağaç bahçelerinin özeti
  demo/script.json  Tanıtım turunun sahneleri
supabase/migrations/0001_init.sql … 0036_tree_claim.sql (sırayla çalıştır)
src/demo/audio/   Tanıtım sesleri ve kelime zamanları (npm run demo:audio, Gemini TTS; demo/audio.ts bundle'a alır)
ASSETS_LICENSES.md 3D modellerin lisansları (Kenney, CC0)
src/config/economy.json, items.json   Ekonominin tek kaynağı (npm run config:sql → yeni migration)
supabase/functions/daily-report/   Günlük rapor (Edge Function)
```

## Oyunlaştırma: çalıştıkça büyüyen ev ve bahçe (10–14 yaş)

Ana döngü: **çalış → bugünün ağacı büyür → ağacından Elmasını al → Elmasla odalarını ve karakterini süsle.**
Evin büyüklüğü yalnızca çalışmayla, güzelliği Elmasla artar. Tek oyunculu; ev ve bahçe verisi `user_id`'ye bağlı.

### Dünyam: Habbo gibi odalar

Alt menüdeki **Dünyam**, react-three-fiber ile çizilen odalar: Habbo'daki gibi **odalara tek tek girilir**. Seçilen
oda koyu bir boşlukta yüzen bir ada; yalnızca arkadaki iki duvarı var, kamera hep aynı açıdan bakar (yakınlaştırma
ve kaydırma var). Sahne yalnızca bir şey değişince çizilir (`frameloop="demand"`); ⛶ tam ekran açar.

- **Oda şeridi:** 🛋️ Odam · 📚 Kütüphane · eklediğin odalar ve teraslar · ➕ Oda ekle. Kapıya dokununca karakter
  kapıya yürür ve yan odaya geçer (evin sırası: kütüphane | oda | eklenen odalar). Karakterin yeri her odada saklanır.
- **Alttaki panel (pop-up yok):** bir eşyaya dokununca panelde resmi, adı, nadirliği, ne işe yaradığı ve düğmeleri
  çıkar: kullan (otur, yat, sallan, aç-kapa, renk, depo, raflar, müzik, pano…; karakter yanına yürür, sonra yapar),
  ✋ Taşı, ↻ Döndür, 📦 Kaldır. Karaktere dokununca dans, el sallama, hayvan ve kıyafet düğmeleri. Sekmeler:
  **🎒 Envanter** (eşya seç, sonra karoya dokun; çit gibi eşyalar elde kalır), **🛍️ Dükkân** (katalog; "🏠 Hemen
  yerleştir" eşyayı ele verir), **🎨 Oda** (zemin/duvar kaplaması, şekil, oda ekle, yakından gez). Kaydet tuşu
  yok: her değişiklik hemen kaydedilir, sunucu doğrular (`save_space`); kaldırma ve taşımada ↶ Geri al.
- **Odalar ve teras:** istediğin türde (mutfak, yatak odası, banyo, salon… ya da **🌿 Teras**) en çok 12 oda eklenir.
  Teras açık havadır: çim zemin, duvar yok; çit, çiçek, bostan, kamp ve heykel gibi dış eşyalar buraya konur.
- **Blok düzenleyici:** eklenen odanın şekli bir şablonla (Kare, L, Basamak…) başlar, sonra **karo karo** değişir:
  karoya dokun, zemin eklensin ya da çıksın; en/boy düğmeleri kutuyu büyütür (en çok 42×20). Arka sıra ve sol sütun
  duvar dibidir, hep dolu kalır; karolar birbirine bağlı olmalı. Yeni şekle sığmayan eşyalar envantere döner.
- **Ev yerinde büyür:** toplam (sayaçla ölçülen) çalışmayla aşama aşama: 🌼 Açıklık → 🏞️ Dere Kenarı (15 sa) →
  ⛰️ Tepe (40) → 🦆 Göl (80) → 🏖️ Sahil (150). Oda (12×10 → 20×14) ve kütüphane yalnızca doğuya ve güneye büyür:
  **eşyalar yerinde kalır**. Pencereden görünen manzara aşamaya göre değişir.
- **Kütüphane:** gömme raflarda ve odaya konan kitaplıklarda **bitirilen kitaplar 3D** durur; kitaba dokununca kitap
  kartı açılır.
- **Eşyalar işlevli:** lamba, şömine, TV açılıp kapanır (açık lambaların en yakın dördü gerçek ışık saçar); **TV**'de
  📊 çalışman ve 🌳 bu ayın ormanı; radyo/pikap müzik çalar, mantar panoya not asılır, masada ders çalışılır.
- **🚶 Yakından gez:** seçili odada üçüncü şahıs kamerayla yürü (joystick / WASD), odaya saklanan 8 yıldızı topla;
  eşyalara dokununca aynı düğmeler alttaki çubukta.
- **Çalışırken oyun kapalı:** sayaç çalışırken Dünyam ve Koleksiyon yerine karakterinin masada çalıştığı oda görünür:
  sayaca dön ya da ☕ ara ver ve gir.

### Bahçem: her gün bir ağaç

Alt menüdeki **Bahçem** ayrı bir sayfa ve süslenmez: yalnızca ağaçlar.

- **Her gün bir ağaç:** çalışılan her gün (sayaç ya da elle yazılan süre) o ayın bahçesine bir ağaç dikilir. Türü o
  gün seçilen tohumdan (Bugün → 🌱 Tohum seç), seçilmediyse tarihten. Büyüklüğü günün toplamından: Fidan, 60 dk Genç,
  120 dk Tam, 180 dk Nadir (ışıltılı); seri günü dibinde çiçek. Yarıda bırakılan seans ağaç dikmez.
- **Ağaçtan Elmas:** o günün Elması (ders, canlı bonus, elle yazılan, seri, plan, "nasıl geçti", günlük görev, aile
  görevi) **ağacında bekler**; üstünde 💎 parlar. Ağaca dokun → gün kartı → "💎 N Elmas'ı al". Hiç kaybolmaz; o gün
  daha çok çalışırsan yeni Elmas yine ağaçta birikir. Haftalık görevler ve kitaplar kendiliğinden gelir.
  (`0036_tree_claim.sql → claim_day`; 18 Ekim 2026'dan önceki günler kendiliğinden yazılmıştı.)
- **Nadir ağaç ödülü:** bir günde 180 dk **sayaçla** çalışınca ağacın dibinden yalnızca bu yolla bulunan nadir bir
  eşya çıkar (gün kartında "🎁 Ödülünü al").
- **Aylık bahçeler:** Eylül 2026 – Haziran 2027 arası her ay bir bahçe; takvim düzeni (sütun haftanın günü, satır
  ayın haftası), çalışılmayan günün yerinde numaralı taş, günü gelmemiş aylar kilitli. Altında aynı ay bir takvim
  olarak da durur (3D yoksa yalnızca takvim). **Canlılar** ağaçlar çoğaldıkça kendiliğinden gelir.
- Modeller Kenney Nature Kit, Furniture Kit ve Cube Pets (CC0); avatar, posterler ve kitaplar kodla çizilir. Ayrıntı
  `ASSETS_LICENSES.md`.

### Karakterim (Profil)

Parça parça avatar: ten rengi, boy, gözler ve göz rengi, kaşlar, ağız, yanaklar, saç (12 model) ve rengi, üst, alt,
ayakkabı, şapka, gözlük, sırt (çanta, pelerin, kanat, jet çantası…). Renkli parçaların rengi seçilir. Bazı parçalar
ücretsiz, çoğu 💎 Elmasla, birkaçı başarıyla açılır (taç, astronot tulumu). Düzenleyicide sende olmayanı da
deneyebilir, oradan alabilirsin; giyilen parçaların sahipliğini sunucu da denetler (`equipped_check`).

### Güvenilir süre: seanslar sunucuda (`0009_sessions.sql`)

- **Süre sunucunun saatiyle tutulur.** "Başlat" sunucuda bir seans açar; dakikayı sunucu hesaplar ve kaydı o yazar (`source = 'timer'`).
- **Sayaç açıkken** uygulama dakikada bir "buradayım" der. Haber gelmezse (sekme kapandı, ekran kilitlendi, internet gitti) sunucu son haberden 90 sn sonra saymayı bırakır.
- **Sekme değişince** sayaç duraklar, geri gelince "Devam et" çıkar. Sayaç çalışırken oyun ekranları kapalıdır; ara verince açılır.
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
  - **Ağaçtan alınır:** güne bağlı Elmas o günün ağacında bekler, Bahçem'de ağaca dokununca kumbaraya geçer.
- **⭐ Yıldız** gezintide toplanır (günde 8). Para değildir, koleksiyonda birikir.
- **Dükkân:** mobilya (oturma, masa, yatak odası, kitaplık, mutfak, banyo, elektronik, oyuncak), ışık, bitki, halı,
  duvar süsü, zemin/duvar kaplaması (desenli), dış mekân (çit, yol, çiçek, bostan, doğa, kamp, heykel) ve kıyafet;
  ~150 eşya ve ~50 kıyafet parçası, alt başlıklarla. Satın alma
  tek işlemde: bakiye düşer, eşya envantere eklenir (`owned_items` tetikleyicisi). Nadirlik: yaygın, nadir, efsanevi.
  - Nadir eşyalar ticaretle değil başarıyla açılır: 100 saatte "Bilge'nin yıldız lambası", 30 günlük seri, 10 planlı gün, derslerde altın, Efsane seviyesi. Bir kısmı yalnızca sandıktan çıkar.
- **Haftalık sandık:** haftada 5 gün ve 150 dk çalışınca açılır, içinden sürpriz bir eşya çıkar. Satın alınamaz.
- **Seviye ve ders yetenekleri (Profil):**
  - Toplam saate göre Çırak → Kâşif → Orman Bekçisi → Bahçıvan → Orman Ustası → Orman Bilgesi → Efsane.
  - Her ders bronz/gümüş/altın olur; unvanlar Bilge, Hikâyeci, Mucit, Gezgin… En az çalışılan ders "bunu da büyüt" diye vurgulanır.
- **Koleksiyon defteri:** bütün eşyalar (eksikler gölge gibi) ve ağaç bahçelerinin özeti (Bahçem'e bağlantı).
- **Aile paneli → Oyun ve Elmas:** bakiye, son hareketler, hediye Elmas (1–50), kuralların özeti.
- **Kopya önlemi:** süreyi ve kazancı sunucu hesaplar. Deftere ve sayaç kayıtlarına yalnızca sunucu fonksiyonları yazar; kaydın süresi sonradan değiştirilemez. Bakiyeyi aşan alışveriş, sandık havuzunda olmayan eşya ve defter silme reddedilir.

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
- **Alt menü:** Bugün · Dünyam · Bahçem · Kitaplık · Geçmiş · Profil. Dersler, Ödüller, Aile paneli ve Tanıtım Profil'in altında.

## Okuma ve kitaplık

Okuma ağaç vermez; kendi kitaplığını oluşturur ve kitaplar odadaki **kitaplığın raflarına** dizilir.

- **Kitap ekle:** ad ya da ISBN ile **Open Library'de ara**; kapak, yazar ve sayfa sayısı gelir. Bulunamazsa ad elle
  yazılır, kitap renkli sırtla görünür. Okuyacağım / okuyorum / bitirdim; bitirdiğin kitapta **"En sevdiğin kısım neydi?"** zorunlu.
- **"📖 Okudum":** kaç dakika + kaçıncı sayfaya gelindi → okunan sayfa hesaplanır, ilerleme çubuğu dolar.
  Son sayfaya gelince bitirme akışı açılır (sayfa sayısı bilinmeyen kitaplar kitap kartındaki "Bitirdim" ile).
- **Bitirince:** en sevdiğin kısım, 1–5 yıldız, en sevdiğin karakter, bir cümleyle anlat → kutlama, kitap rafa dizilir.
- **Evdeki kitaplık:** bitirilen kitaplar kütüphane odasının gömme raflarında ve odadaki kitaplıklarda 3D durur
  (sırtında adı); kitaba dokununca kapağı ve en sevdiğin kısım. "Bütün kitaplarım" görünümünde rafta 12 kitap, dolunca
  yeni raf (`0013_books_shelf.sql`).
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
- **Metni Gemini yazar** (Google Gemini API, `generateContent`; varsayılan model `gemini-3.8-flash`, `REPORT_MODEL` ile değiştirilebilir). Yanıt JSON şemasıyla istenir; model önce düşündüğü için token bütçesi 4000, düşükse JSON yarım kalır ve yedek metne düşülür. Rakamlar ve tablo
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
   supabase secrets set GEMINI_API_KEY=... RESEND_API_KEY=... \
     REPORT_FROM="Çalışma Takip <rapor@alanadin.com>" CRON_SECRET=$(openssl rand -hex 24)
   supabase functions deploy daily-report     # config.toml: verify_jwt = false (kendi auth'unu yapar)
   ```
4. `0004_reports.sql`'in sonundaki yorum satırındaki `cron.schedule` bloğunu proje ref'i ve
   CRON_SECRET ile doldurup SQL Editor'de bir kez çalıştır (saatte bir tetikler; her kullanıcının
   saatine bakar).

**Gizlilik:** Raporu hazırlarken o günün kayıtları ve çocuğun "nasıl geçti" notu Google'ın Gemini API'sine gönderilir.
Gemini API'nin ücretsiz katmanında Google gönderilen içeriği ürünlerini geliştirmek için kullanabilir; ücretli katmanda (faturalandırma açık) kullanmaz.
Uygulamaya ebeveynin hesabıyla girildiği ve ayarlarda bu açıkça yazdığı için onay ebeveyndedir; rapor kapatılabilir.

## Tanıtım turu (sesli ve yazılı)

- İlk girişte Bugün ekranında **"Demoyu başlat 🔊"** / **"Sessiz izle"**. Tur her sahnede ilgili sayfayı açar, ilgili
  ögeyi öne çıkarır (driver.js) ve altyazıyı **kelime kelime** vurgular. Geri, duraklat, ileri, sessize alma; Esc kapatır.
- Sesler önceden üretilir, canlı TTS yok: `npm run demo:audio` (`scripts/gen-demo-audio.mjs`) her sahne için
  Gemini TTS'ten sesi alır, ffmpeg ile `src/demo/audio/<sahne>.mp3` yapar (ses yüksekliği `loudnorm` ile eşitlenir); kelime zamanlarını sesin duraklamalarından
  çıkarıp `.json` yazar. Her ses ayrıca Gemini ile yazıya dökülüp metinle karşılaştırılır; tutmayan ses kaydedilmez
  (`--no-check` kapatır). `GEMINI_API_KEY` `.env`'de durur ve ön yüze girmez. Ses dosyası yoksa tur kendiliğinden
  yazılı moda geçer. Ücretsiz katman model başına günde ~10 istek verir: kota biterse ertesi gün yeniden çalıştır.
- Sahneler ve metinler `src/demo/script.json`'da. Metni değiştirince `npm run demo:audio` yalnızca yeni ve metni
  değişen sahneleri üretir (`--force` hepsini). Sesi eski kalan sahne, ses yeniden üretilene kadar yazılı oynar.

## Notlar

- Sayaç sunucuda tutulur: sayfa yenilense de açık seans sunucudan gelir; sekme değişince duraklar.
  "Bitirdim"de süre durur, ders ve "Ne çalıştın?" notu sorulur; süre elle değiştirilemez.
- Çalışma kaydı, sayacın **başladığı** günün tarihine yazılır (gece yarısını geçen oturumlar için).
- Bir ders silinince ona ait çalışma kayıtları da silinir (cascade); görevlerdeki ders etiketi boşalır.
- `daily_reflections` (user_id, date) üzerinde unique; kayıt upsert ile yapılır.
