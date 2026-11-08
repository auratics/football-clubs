# Most Irritating Club

"Bu ay seni en çok hangi futbol kulübü sinir ediyor?" – reklam bannerlarından gelir elde etmek için basit bir oylama sitesi.

**Harici paket yok.** Site tek bir Node.js sunucusu, tek bir SQLite veritabanı dosyası ve sade HTML/JS'den oluşuyor. `npm install` gerekmez, takip edilecek paket güncellemesi de yoktur.

## Bilgisayarında çalıştırma

```bash
node server.js
```
Tarayıcıda http://localhost:3000 adresini aç. **Node.js 22.13 veya üstü** gerekir.

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `server.js` | Sunucu kodunun tamamı (oylama, sıralamalar, yönetici paneli, ağustos hatırlatması) |
| `data/leagues.js` | **İlk** açılışta yüklenen ligler ve kulüpler (55 lig) |
| `data/votes.db` | Veritabanı. Kendiliğinden oluşur. **Bu dosyayı düzenli yedekle.** |
| `public/` | Sitenin kendisi (ana sayfa, yönetici, gizlilik sayfaları) |

## Ayarlar (ortam değişkenleri)

| Değişken | Ne işe yarar | Örnek |
|---|---|---|
| `PORT` | Port numarası | `3000` |
| `ADMIN_PASSWORD` | `/admin` paneli şifresi. Ayarlanmazsa panel kapalı kalır. | `guclu-bir-sifre` |
| `IP_HEADER` | Ziyaretçinin gerçek IP'sini taşıyan başlık. **Barındırma hizmetine uygun olmalı.** | `cf-connecting-ip` (Cloudflare) veya `x-forwarded-for` (Railway/Render) |
| `IP_VOTES_PER_LEAGUE_PER_WEEK` | Aynı internet bağlantısından bir ligde haftada en fazla kaç oy verilebileceği | `3` (varsayılan) |
| `DB_PATH` | Veritabanı dosyasının yeri | `/data/votes.db` |
| `NTFY_TOPIC` | Ağustos hatırlatması için konu adı (aşağıya bak) | `mhc-hatirlatma-x7k2q` |
| `ADMIN_EMAIL` | Hatırlatmanın e-postayla da gönderileceği adres | `sen@mail.com` |

## Kurallar

- Ziyaretçi **her ligde haftada bir kulübe** oy verebilir. Aynı hafta içinde farklı liglerde oy kullanabilir.
- Tekrar tekrar oy vermeyi iki kontrol engeller:
  1. **Çerez**: Tarayıcıya rastgele bir kimlik verilir; aynı tarayıcı aynı ligde 7 gün içinde ikinci kez oy veremez.
  2. **IP sınırı**: Biri çerezlerini silse bile aynı bağlantıdan bir ligde haftada en fazla 3 oy verilebilir. Sınırın 1 olmamasının sebebi, birçok kişinin aynı IP'yi paylaşması (mobil şebekeler, okul ya da iş yeri Wi-Fi'ı). IP adresleri açık halde saklanmaz, yalnızca şifrelenmiş (hash) halde tutulur.
- Aylık sıralama **her ayın 1'inde (UTC)** sıfırlanır. Eski aylar silinmez; ana tablodaki "Period" filtresinden görülebilir (geçmiş aylar, yıllık toplamlar, tüm zamanlar).
- Ziyaretçinin ülkesi Cloudflare'in `CF-IPCountry` başlığından alınır. Cloudflare yoksa tarayıcının dil ayarından kaba bir tahmin yapılır (ör. `en-US` → ABD). **Ülke sıralamalarının doğru olması için siteyi Cloudflare arkasına koy.**

## Küme düşen/çıkan kulüpler (her ağustos)

1. 1 Ağustos'ta sunucu sana bildirim gönderir (`NTFY_TOPIC` ayarlıysa):
   - Telefonuna ücretsiz **ntfy** uygulamasını kur ve seçtiğin konu adına abone ol (tahmin edilmesi zor bir ad seç).
   - `ADMIN_EMAIL` ayarlıysa aynı mesaj e-posta olarak da gelir.
2. Ağustos boyunca `/admin` sayfasının üstünde kırmızı bir "kulüpleri güncelleme zamanı" uyarısı görünür.
3. `/admin` sayfasında bir lig seç. Listede her satırda bir kulüp vardır. Düşen kulüpleri sil, çıkanları ekle, sonra **Save**'e bas.
   - Bir kulüp aynı ülke içinde lig değiştirdiğinde adını öncekiyle birebir aynı yazarsan eski oyları da onunla birlikte taşınır.
   - Listeden çıkarılan kulüpler silinmez. Yalnızca gizlenir; eski oyları arşivde kalır.
4. İşin bitince "I'm done for this season" butonuna bas, uyarı kaybolur.

> Kulüp listeleri Kasım 2026'da Wikipedia sezon sayfalarından alındı (2026/27 ya da takvim yılına göre 2026 sezonu). Hata görürsen `/admin` panelinden düzeltebilirsin.

## Yayına alma (önerilen: Railway veya Render + Cloudflare)

SQLite **kalıcı bir diske** ihtiyaç duyar, bu yüzden barındırma hizmetinde bir "volume/disk" eklemen gerekir.

1. Projeyi GitHub'a yükle.
2. **Railway**'de (veya Render'da) bu repodan yeni bir proje oluştur. Başlatma komutu: `node server.js`.
3. Bir **Volume** ekle ve `/data` konumuna bağla, sonra `DB_PATH=/data/votes.db` olarak ayarla.
4. `ADMIN_PASSWORD`, `NTFY_TOPIC`, `ADMIN_EMAIL` ve `IP_HEADER` değişkenlerini ayarla.
5. Bir alan adı al ve **Cloudflare**'e ekle (ücretsiz plan), proxy açık olsun (turuncu bulut). Sonra `IP_HEADER=cf-connecting-ip` yap. Böylece ülke tespiti, temel saldırılara karşı koruma ve ücretsiz önbellek kazanırsın.

Küçük bir VPS (ör. Hetzner, ayda ~4 €) da olur. Ayarlar aynı; `node server.js`'i pm2 veya systemd ile çalıştır.

## Reklamlar (Google AdSense)

1. AdSense seni onaylamadan önce alan adı olan, yayında bir site ister. Sitede gizlilik sayfası (`/privacy`) zaten var.
2. Onaylandıktan sonra:
   - AdSense'in verdiği `<script>` satırını `public/index.html` dosyasında `<head>` içinde işaretli yere yapıştır.
   - İki `<div class="ad" ...>Advertisement</div>` kutusunu AdSense reklam birimleriyle değiştir.
   - AdSense'in verdiği satırı `public/ads.txt` dosyasına ekle.
3. Avrupa'daki (AB/İngiltere) ziyaretçiler için Google **çerez onay penceresi** şart koşuyor. **AdSense → Gizlilik ve mesajlaşma** bölümünden ücretsiz onay mesajını (CMP) aç; kodda değişiklik gerekmez.

## Yedekleme

Tüm verin `votes.db` dosyasında. Bu dosyayı her hafta başka bir yere kopyala. SQLite ile site çalışırken de güvenle yedek alabilirsin:
```bash
sqlite3 /data/votes.db ".backup /data/yedek-$(date +%F).db"
```

## GitHub Pages demosu

Pages sunucu çalıştıramadığı için oradaki sürüm yalnızca tasarımı incelemek içindir: `pages/demo.js` sunucunun yerini tarayıcıda tutar. Sayılar örnek veridir, oylar yalnızca oy verenin tarayıcısında kalır ve `/admin` yoktur. `main` dalına her push'ta `.github/workflows/pages.yml` demoyu yeniden yayınlar. Elle derlemek için: `node scripts/build-pages.js` (çıktı `dist/`).
