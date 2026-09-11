# Daha iyi çıktı ve kontrollü maliyet: veri bağlantıları

10 Eylül 2026. Bu belge entegrasyon önerisidir; aşağıdaki dış veri API’leri bu değişiklikle bağlanmadı. Mevcut açık web araştırması, arama hacmi veya rakiplerin reklam performansı ölçümü değildir.

## Öncelik ve elde edeceğimiz değer

| Öncelik | Bağlantı | Getireceği veri / ürün kararı | Gereken erişim ve maliyet yaklaşımı |
|---|---|---|---|
| 1 | Google Search Console | Kendi sitemizin sorgu, sayfa, gösterim, tıklama, CTR ve pozisyon verisi. Gösterimi yüksek, tıklaması düşük CROV konularından blog/FAQ briefi. | Doğrulanmış siteye yetkili OAuth erişimi. API ücretsiz; kota var. Anonimleştirilmiş/atlanmış sorgular nedeniyle tüm aramaları temsil etmez. |
| 1 | GA4 Data API | Açılış sayfası ve kanal performansı; tanımlanmış kayıt/broşür gibi key event’ler. Üretilen içeriği sonuçla karşılaştırma. | Property erişimi ve doğru event kurulumu. Kota yönetimi gerekir; GA4 kota token’ları LLM token’ı değildir. API geçmişte kaydedilmemiş etkileşimleri geri getirmez. |
| 1 | Mevcut Brand Portal + kurs kataloğu | Güncel logo, font, renk, onaylı iddialar, CTA; aynı bilgiyi AI’ya tekrar keşfettirmeme. | Mevcut entegrasyon kullanılır. CS için eksik metinsel tone-of-voice kuralları portalda yayınlanmalı. |
| 2 | Google Ads Keyword Planning | Anahtar kelime fikirleri, tarihsel arama metrikleri ve planlama verisi; NL/dil/döneme göre konu önceliklendirme. | Google Ads hesabı ve güncel API erişim koşulları. API erişimi hazır varsayılmamalı; kullanıcı hesabının yetkileri kontrol edilir. Tahminler garanti değildir. |
| 2 | Semrush SEO API | Rakip domain/keyword araştırması; ortak ve eksik içerik konuları. Rakip bulma ve sıralama işini yapılandırılmış veriye taşıma. | Ücretli API erişimi ve birim bütçesi. Standard API yardımına göre Business katmanı tek başına birim sağlamaz; ayrıca birim satın alınır. Seçilen v4 endpoint’in sözleşmesi ayrıca kontrol edilir. |
| 2 | SerpApi | Belirli konum/dilde SERP, related questions ve autocomplete araştırması. Web sayfasındaki FAQ ile arama motorunda gözlenen soruyu ayırma. | API anahtarı; ücretsiz/ücretli kota plana bağlı. Soru görünmesi arama hacmi kanıtı değildir. İlk pilot küçük sorgu listesiyle çalışmalı. |
| 3 | Kendi Google Ads / Meta reklam hesabı raporları | Kendi reklamlarımızın harcama, tıklama ve dönüşüm karşılaştırması. Hangi kreatifi yineleyeceğimizi belirleme. | Yetkili reklam hesabı erişimi; sağlayıcı bazında adapter ve izinler gerekir. Bu bağlantılar rakibin özel performans verisini açmaz. |
| 3 | CMS / site içerik kataloğu | Var olan makaleler, URL’ler ve içerik güncellemeleri. Yeni blog yerine mevcut sayfayı iyileştirme, iç bağlantı önerisi. | Kullanılan CMS belli olduğunda salt okunur adapter. Yayınlama ayrı aşama; taslak önce kontrol edilir. |
| Daha sonra | Anonimleştirilmiş CRM / kayıt sonuçları | Hangi iş rolü ve sektörden gerçek kayıt geldiğiyle persona hipotezlerini sınama. | Şu an yalnız açık web kapsamındayız; mevcut MVP’ye dahil değil. Kişilerin mezuniyetini veya sektör dağılımını tahmin ederek veri üretmeyiz. |

Önerilen ilk kombinasyon: **Search Console + GA4 + mevcut Brand Portal**, rakip/keyword bütçesi varsa **Semrush veya küçük SerpApi pilotu**, ardından Keyword Planning. Hepsini birden almak gerekmiyor. Semrush SERP gözlemi, Search Console kendi site verisi, GA4 davranış verisidir; birbirinin yerine geçmezler.

## AI işini nasıl azaltırız?

1. API’den tarih, ülke, cihaz ve sorgu kapsamıyla yapılandırılmış veriyi bir kez al; sıralama, filtreleme, tekilleştirme ve fark hesaplamasını kodla yap.
2. AI’ya ham reklam kütüphanesi/uzun sayfalar yerine seçilmiş kanıt kartlarını gönder. AI’yı yorum, yaratıcı yön ve copy için kullan.
3. Cache anahtarı: label + sağlayıcı + sorgu + ülke/dil + tarih aralığı + şema sürümü. Kaynak tarihi ve güncellik görünür kalsın. Sağlayıcının saklama koşulları geçerli; Semrush verisini sınırsız saklama varsayımı yapma.
4. Aynı briefing/marka/kurs/kaynak sürümünde öneriyi yeniden kullan; yalnız değişen bileşeni üret. Bu genel cache mekanizması henüz uygulanmadı.
5. Banner yerleşimi, paketleme, logo/font uygulaması, boyut ve link kontrolleri deterministik şablonla yapılır; her banner için AI’ya yeniden kod yazdırılmaz. Mevcut renderer bu yaklaşımı kullanıyor.
6. Pilot karşılaştırması: aynı 10 konu için araştırma başına API ücreti + LLM ücreti + yeniden üretim sayısı + editörün düzeltme süresi. Başarı metriği yalnız token değil, kullanılabilir ve onaylanmış paket başına toplam maliyet.

**Daha az LLM kullanımı daha düşük toplam maliyeti garanti etmez.** Düşük hacimde Semrush aboneliği tasarruftan pahalı olabilir. Fiyat teklifi ve gerçek pilot ölçümü olmadan yüzde tasarruf sözü vermeyelim.

## Kaliteyi artıracak tam çalışma listesi

- Radar: kendi marka / rakip / otorite ayrımı; tarih ve kapsam; erişilemedi / bulunamadı ayrımı; kaynak pasajını gösterme.
- Persona: iş ilanları, kurs hedef kitleleri ve kamuya açık mesleki kaynakları karşılaştırma; tek kaynaktan pazar dağılımı çıkarmama.
- Araştırmadan kampanyaya: seçilen bulgu → hedef kitle → çözülecek sorun → test edilecek mesaj; tüm radar sonuçlarını aynı kampanyaya yığmama.
- Briefing: hedef, önerme, kanallar, CTA, doğrulanmış kendi kurs iddiaları, sınırlar ve ölçüm planı.
- Kaynak izi: kullanılan scan/brief/brand sürümü görünür; araştırma bağlamı ile çıktıda açıkça atıf yapılan kanıt ayrı. Cümle düzeyinde provenance hâlâ geliştirme işi.
- Etkileşim: pratik dilemma, öncelik seçimi, senaryo keşfi; her seçenek için anlamlı farklı geri bildirim. Otomatik kabul/uygunluk puanı yok.
- Kreatif: boyuta göre kompozisyon, markaya ait grafik arka plan, okunur hiyerarşi, gerçek font/logo, her etkileşim durumunda CTA.
- Daha ileri formatlar: karşılaştırma kartı, senaryo simülasyonu, kaydırmalı hikâye. Bunlar henüz ayrı çalışan renderer’lar değil; mevcut üç sorulu motorla aynı şeymiş gibi sunulmamalı.
- SEO: gerçek arama verisi, mevcut içerik çakışması, arama niyeti, iç bağlantılar ve editoryal kontrol; yalnız makale üretmek SEO başarısı değildir.
- Dağıtım: Studio paketi ile Google Ads upload ayrı hedefler; yayıncı QA ve gerçek platform önizlemesi gerekir.
- Ölçüm: UTM standardı, consent uyumlu event şeması, CTA tıklaması ile kayıt ayrımı, kontrol dönemi. Mevcut widget otomatik GA4 bağlantısı kurmaz.
- Operasyon: paket önizlemesi, içerik onayı, marka sürümü değiştiğinde yeniden inceleme, başarısız işi yeniden deneme ve bütçe görünürlüğü.

## Kaynaklar ve arayüz kararları

- [Search Console fiyatlandırma](https://developers.google.com/webmaster-tools/pricing), [Search Analytics sorguları](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).
- [GA4 Data API kotaları](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas).
- [Google Ads Keyword Planning](https://developers.google.com/google-ads/api/docs/keyword-planning/overview).
- [Semrush SEO API](https://developer.semrush.com/api/v4/seo/overview/), [erişim, birimler ve saklama koşulları](https://www.semrush.com/kb/5-api).
- [SerpApi güncel planları](https://serpapi.com/pricing).
- [NN/g sekme kullanımı](https://www.nngroup.com/articles/tabs-used-right/): aynı bağlamın alternatif görünümleri için radar sekmeleri; farklı sayfa/işlemler sekme gibi gösterilmez.
- [WAI-ARIA Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/): klavye okları, Home/End, seçili sekme ve panel ilişkilendirmesi.
- [GOV.UK task list](https://design-system.service.gov.uk/components/task-list/): belirli sırayla ilerlenmesi gereken süreç için task-list uygun değil. Bu yüzden kampanyada gezinilebilir aşamalar var; üretim/onay bağımlılıkları sunucuda korunur.

## Bu değişiklikte doğrulananlar

465 test / 38 dosya geçti; typecheck, lint ve build başarılı. Gerçek tarayıcıda radar sekmeleri, klavye geçişleri, kampanya aşamaları, mobil yatay taşma ve interaktif konsept seçiminin sekmeler arasında korunması kontrol edildi. Gerçek CS marka kaynaklarını kullanan, veritabanına kaydedilmeyen teknik fixture’da 300×250, 336×280 ve 300×600 bannerların soru/cevap/geri dönüş durumları incelendi. Bu teknik kontrol Google platform onayı veya canlı kampanya performans kanıtı değildir. Yeni prompt için bu turda ayrıca ücretli canlı üretim yapılmadı; mevcut metinler aynı kaldı.

## 11 Eylül 2026 — bütün platform ve sosyal/AI görünürlük eki

[Platform veri bağlantıları raporu](../platform-data-integrations-tr.md): gerçek son CROV çalışmasının kaynak/model/maliyet kaydı, motor bazlı yanıt eksikliği, sosyal içerik ve hashtag sınırları, tüm modüller için öncelikli veri/API matrisi ve tasarruf deneyi. Bu ek yalnız planlama raporudur; yeni servis bağlanmadı.
