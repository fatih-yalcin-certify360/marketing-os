# Platform veri bağlantıları: görünürlük, sosyal dağıtım ve maliyet

11 Eylül 2026. Durum: **inceleme ve öneri raporu; yeni entegrasyon veya otomatik yayın uygulanmadı.** Bu belge mevcut [API yol haritasını](crov/data-api-roadmap-tr.md) bütün platform için genişletir. Öncelikler ürün önerisidir; tasarruf yüzdeleri ölçülmüş sonuç değildir.

## 1. Son CROV araştırmasında gerçekte ne yapıldı?

Yerel veritabanında incelenen rapor: b7c4fe92-def7-483a-ae3c-712bc62ff1d6. Job: 60638c45-154f-48f6-88a5-ddc658b7c5fa. Kayıt zamanı: 11 Eylül 2026, 08:04:26 UTC. Yöntem web_research, isMock=false.

Okunan altı kaynak:

- [CS Opleidingen CROV](https://cs-opleidingen.nl/opleidingen/casemanager-regie-op-verzuim-crov): kendi kurs sayfası.
- [Habeo+ CROV](https://habeoplus.nl/opleidingen/hrm/duurzame-inzetbaarheid/casemanagement-regie-op-verzuim-crov).
- [SV Land CROV](https://www.svland.nl/opleidingen/crov-opleiding).
- [UWV — Plan van aanpak](https://www.uwv.nl/nl/ziek/loondoorbetaling/plan-van-aanpak).
- [Arboportaal — re-integratie](https://www.arboportaal.nl/onderwerpen/verzuim-en-re-integratie/re-integratie-en-wet-verbetering-poortwachter).
- [UWV — Probleemanalyse](https://www.uwv.nl/nl/ziek/loondoorbetaling/probleemanalyse).

Kaynak listesindeki kuruluş ilişkileri ayrıca doğrulanmalıdır; dış domain otomatik olarak bağımsız rakip anlamına gelmez. Bu raporda başarısız sayfa okuması kaydı yok. LinkedIn veya Instagram kaynağı yok. Bu, bu platformlarda ilgili paylaşım olmadığı anlamına gelmez.

İşlem kullanım kayıtları:

| Adım | Sağlayıcı/model | Girdi token | Çıktı token | Maliyet alanları |
|---|---|---:|---:|---|
| geo.discover | openai / gpt-5.6-terra | 21.901 | 518 | actual_cost_cents=null; estimated_cost_cents=106 |
| geo.analyze | openai / gpt-5.6-terra | 12.682 | 2.538 | actual_cost_cents=6; estimated_cost_cents=8 |

Toplam 34.583 girdi ve 3.056 çıktı token kaydedilmiş. Arama adımının gerçekleşen maliyeti bilinmediğinden toplamı kesin €1,12 olarak sunamayız; tahmin ile gerçekleşen değer birbirine karıştırılmamalı. Platform kullanım defteri sağlayıcı faturası değildir. Tek çalışma, gelecekteki ortalama maliyet veya tasarruf kanıtı olamaz.

**Motor bazlı cevapların görünmemesinin nedeni:** bu iş ayrı ayrı ChatGPT, Gemini, Claude, Perplexity veya Google AI Mode cevaplarını toplamıyor. Bir sağlayıcının API destekli web araştırması ve ardından sayfa analizi çalışıyor. Raporda sayfa metinleri ve alıntılar var; consumer motor yanıtları, sıraları ve ekran görüntüleri yok. Mevcut veriyle geçmişe dönük motor cevabı üretilemez.

Arama adımı kaynak URL'leri seçiyor; her soru için tam sorgu → tüm sonuçlar → elenen kaynaklar zinciri raporda ayrı alanlar halinde saklanmıyor. Provider/model kullanım defterinde olsa da rapor arayüzüne taşınmış değil. Bunlar gerçek izlenebilirlik eksikleri.

## 2. Görünürlük ekranında önerilen ayrım

Üç kavram ayrı görünmeli:

| Görünüm | Gösterilecek kanıt | Söylenemeyecek şey |
|---|---|---|
| Araştırma günlüğü | API sağlayıcı/model, sorular, varsa gerçek arama sorguları, dönen URL'ler, okunma/elenme nedeni, tarih, maliyetin bilinen/tahmini kısmı | “Bütün AI motorlarında aradık” |
| Motor cevapları | Her motor için ham cevap, yöntem (consumer/manual/API/third party), ülke/dil, oturum, model biliniyorsa, tarih, markalar, alıntılar ve tekrar sayısı | API-model cevabı = consumer uygulaması cevabı; isim geçişi = öneri sıralaması |
| Aksiyonlar | Kanıtlı ihtiyaç → kurs sayfası/blog/sosyal öneri → kampanya/brief → insan onayı → yayın → ölçüm | İsim görünmedi → otomatik olarak içerik açığı var |

Motor kartlarının durumları: ölçülmedi, sırada, başarılı, engellendi, teknik hata. Ölçülmedi/engellendi değerleri sıfır görünürlük oranına çevrilmemeli. API verisi ayrı filtrelenmeli. Geçmiş rapora yeni motor ölçümü eklenirse ayrı tarihli ölçüm olarak iliştirilmeli; önceki çalışmanın çıktısıymış gibi gösterilmemeli.

Çok motorlu ölçüm maliyeti soru × motor × tekrar × ölçüm dönemiyle büyür. Önce sabit küçük soru setiyle baseline; yalnız anlamlı içerik değişikliklerinden sonra tekrar önerilir. Tedarikçinin “ChatGPT data” ifadesi tek başına consumer deneyimini temsil ettiğini kanıtlamaz. [DataForSEO LLM Responses](https://docs.dataforseo.com/v3/ai_optimization-llm_responses-overview/) aday adapter kaynağıdır; endpoint'in gerçek toplama yöntemi ve ürün eşdeğerliği satın almadan önce doğrulanmalıdır.

## 3. Sosyal medya görünürlüğe nasıl katkıda bulunabilir?

LinkedIn'de Anyone görünürlüğündeki gönderiler LinkedIn dışından da görülebilir; görünürlük ayarları ve erişim bağlamı önemlidir. Bu, her AI motorunun her gönderiyi okuyup alıntıladığı anlamına gelmez. [LinkedIn resmi açıklaması](https://www.linkedin.com/help/linkedin/answer/a523141/?lang=en).

Açık ve erişilebilir sosyal içeriklerin aramada bulunması, yeniden paylaşılması veya başka sitelerde referans verilmesi **katkı sağlayabilecek yollar**dır. Bunlardan CS'nin AI cevaplarında daha üstte çıkacağı sonucu otomatik çıkmaz. İçeriğin yayınlanması, erişilebilir olması, indekslenmesi, bir sorguda bulunması ve AI cevabında kaynak seçilmesi farklı aşamalardır. Google da AI özellikleri için yararlı/güvenilir içerik ve temel SEO gerekliliklerini esas alır; görünme garantisi vermez. [Google AI features rehberi](https://developers.google.com/search/docs/appearance/ai-features).

Instagram için hesabın/postun erişim ve indekslenme durumu ayrıca kontrol edilmeli. Bu incelemede ilgili Meta yardım sayfası giriş ekranına yönlendi; Instagram hashtag API dokümanı okunamadı. Dolayısıyla bütün Instagram gönderileri indekslenir, belirli bir hashtag kotası kesindir veya seçilecek API bütün rakip gönderilerini verir gibi iddialar bu raporda doğrulanmış kabul edilmez.

Mevcut GEO modülü metin olarak okunabilen web sayfalarını işliyor. Sosyal hesap API'si, akış taraması, görsel OCR veya video transkripsiyonuyla sosyal içerik analizi yok. Rastlantısal açık sosyal URL bulunması, sosyal ağın tarandığı anlamına gelmez. Başka AI ürünlerinin erişim kapsamı da bizim uygulamamızın erişim kapsamından farklı olabilir.

### Sosyal önerinin içeriği

Her ilgili araştırma konusu için şu alanlar önerilmeli:

1. Kanal seçimi ve gerekçesi: hedef kitlenin o kanalda bulunduğuna ilişkin veri veya açık hipotez.
2. Gönderinin cevapladığı soru, okuyucuya kattığı bilgi ve dayanak kaynak.
3. Kurs sayfasına ek bilgi mi, bloga dağıtım mı, uzman açıklaması mı? Gereksiz içerik tekrarı önlenmeli.
4. Kanal biçimi: LinkedIn uzman açıklaması/doküman; Instagram görsel anlatım veya kısa video ancak hedef kitle ve üretim kapasitesi uygunsa.
5. Taslak metin, görsel/video briefi, CTA, kanala uygun bağlantı yolu ve UTM planı.
6. Konu kelimeleri ve sınırlı hashtag adayları; her aday için kaynağı, platformu, veri tarihi ve ölçülmüş/hipotez ayrımı.
7. Kontrol: onaylı kurs gerçekleri, güncel marka kuralları, insan incelemesi.
8. Ölçüm: içerik erişimi, uygun etkileşimler, siteye geçiş ve kayıt/broşür talebi; ayrıca ayrı AI benchmark takibi.

CROV için örnek hipotez: “HR-professional rolü ile casemanager rolünü nasıl ayırırsın?” sorusuna bir blog karar çerçevesi, LinkedIn'de uzman açıklaması, uygun kitle varsa Instagram'da görsel özet. Bunlar araştırılmış performans önerileri değildir; hangi kanala bütçe ayıracağımızı mevcut hesap verisiyle sınamalıyız.

### Hashtag araştırması neyi yapar, neyi yapmaz?

Hashtag adaylığı, platform içi konu eşleşmesini destekleyebilir. Hashtag popülerliği Google arama hacmi değildir; bir etikette görünmek AI öneri sıralaması değildir. “Hashtag aracı bağlayınca GEO yükselir” iddiası kurulamaz.

[RiteTag](https://ritetag.com/) hashtag önerisi sağlayan bir ürün adayıdır. Ancak güncel API erişimi, platform bazlı veri kökeni, dil/NL kapsaması, lisans ve kota bu incelemede doğrulanmadı. Sırf öneri üretmek için yeni ücretli araç almak yerine önce yetkili kendi hesaplarının gerçek içerik performansı değerlendirilmeli. Böyle bir aracın değeri, AI gibi tahmin üretmesinden değil, erişemediğimiz ve doğrulanabilir veri sağlamasından gelmeli.

## 4. Bütün platform için veri/API matrisi

Aşağıdaki bağlantılar **adaydır**, bağlanmış servis listesi değildir. “LLM azalması” niteliksel beklentidir, ölçülmüş tasarruf değildir.

| Öncelik / alan | Veri ve aday bağlantı | Kodla yapılacak iş; AI'nın kalan işi | Kalite faydası ve kabul ölçütü | Erişim/maliyet sınırı |
|---|---|---|---|---|
| P0 — Kaynak izi | Mevcut job, usage_records, kaynak snapshot'ları | Sağlayıcı/model, çağrı, maliyet, kaynak ve hata kayıtlarını birleştirmek için LLM gerekmez | Her öneriden gerçek kaynak/işleme gidilebilir; bilinmeyen maliyet açık | Mevcut veriler kullanılır; eksik consumer cevapları geri üretilemez |
| P1 — Marka | Mevcut Brand Portal API | Sürüm ve değişiklik kontrolü kodla; AI yalnız üslup uyarlaması | Eski kuralla üretim fark edilir; eksik metinsel kurallar görünür | Zaten bağlı altyapı; kaynaktaki eksik kural API ile oluşmaz |
| P1 — Kurs ve içerik envanteri | Mevcut kurs kataloğu + kullanılan CMS'nin salt okunur API'si/sitemap | URL, mevcut içerik, başlık ve hash toplama; AI yalnız ilgili bölümü değerlendirme | Yeni blog yerine mevcut içeriğin güncellenmesi; doğru iç bağlantı | CMS ürünü/izinleri netleştirilmeli; Course Truth onayı korunur |
| P1 — SEO talebi | Google Search Console Search Analytics | Sorgu/sayfa/ülke/tarih filtreleri ve farklar SQL ile; AI niyet ve brief yorumlar | Kendi sitemizin gerçek gösterim/tıklama fırsatları | Site yetkisi, kota ve eksik/anonim sorgular; tüm pazarın verisi değil |
| P1 — Sonuçlar | GA4 Data API + tutarlı event/UTM düzeni | Kanal, açılış sayfası, key event karşılaştırması kodla | İyi görünen içerik ile kayıt getiren içerik ayrılır | Property izni, consent ve önceden doğru event kurulumu; GA4 token kotası LLM kredisi değildir |
| P1 — Kendi sosyal içerikleri | LinkedIn Community Management; uygun Instagram hesap/insights API erişimi | İzinli postları, tarihleri ve performansı toplama; AI konu/format örüntüsünü yorumlar | Geçmiş kazanan içerik ve gerçek kitle davranışı kullanılır | Hesap/page yetkisi ve uygulama incelemesi; rakiplerin özel analitiğine erişim sağlamaz. Meta endpoint kapsamı doğrulanmalı |
| P2 — Arama sonuçları | SerpApi veya DataForSEO SERP adapter pilotu | Konum/dil/tarih bazlı sonuçları çekmek, URL tekilleştirmek | “Webde bulduk” yerine sorgu ve sonuç izi; AI arama çağrılarını azaltma adayı | Ücretli sorgular/kotalar; sonuç pozisyonu dalgalanır, arama hacmi değildir |
| P2 — Keyword/long-tail | Google Ads Keyword Planning | Fikir, tarihsel metrik, lokasyon/dil ve eleme; AI niyet kümeleri/brief | Konu önceliği gerçek veriyle desteklenir | Developer token ve Ads erişimi; tahmin ve reklam rekabeti organik SEO zorluğu değildir |
| P2 — Rakip/SEO kapsamı | Semrush SEO API veya alternatif SEO veri sağlayıcısı | Rakip domain, keyword gap ve sayfa listelerini toplama; AI farklılaşma | Radar keşfindeki tekrar aramaları azaltma, rakip seçimini kanıtlama | API planı ve birimleri ayrı kontrol edilir; örneklemler tahmin olabilir, rakip dönüşümü bilinmez |
| P2 — Motor cevapları | İzinli consumer ölçümü / ayrı resmi model API'leri / doğrulanmış third-party adapter | Cevapları saklama, marka/domain eşleme ve payda hesabı kodla | Motor × soru × tarih kanıt matrisi | Yeni veri toplama ek maliyet getirir; API-model/consumer eşdeğerliği varsayılmaz |
| P2 — Sosyal dinleme | Brandwatch Consumer Research API gibi lisanslı kaynak | Erişilebilir mentions/konular toplama, tekilleştirme; AI anlam/yaratıcı öneri | Gerçek konuşma örnekleriyle radar ve persona hipotezleri | Ağ/ülke/dil/geçmiş kapsamı ve yeniden saklama lisansı tekliften doğrulanmalı; bütün sosyal web değildir |
| P3 — Hashtag | Yetkili platform özellikleri veya RiteTag benzeri doğrulanmış veri ürünü | Kaynaklı adaylar ve mevcut performans eşlemesi kodla | Etiket seçiminin gerekçesi ve tarihli dayanağı | API/endpoint ve gerçek NL/konu verisi doğrulanmadan satın alma; LLM tasarrufu muhtemelen ikincil |
| P2 — Kendi reklam performansı | Google Ads raporları, Meta Marketing API; gerekiyorsa LinkedIn Ads raporları | Harcama/tıklama/dönüşüm ve kreatif eşlemesi kodla | Kreatif yenileme/sonlandırma kararının ölçüme bağlanması | Kendi hesap yetkileri gerekir; reklam harcaması API maliyetinden ayrıdır |
| P2 — Rakip reklam kanıtı | Mevcut reklam şeffaflık kaynakları ve koşulları doğrulanmış adapter | Kreatif/landing URL/tarih/durum arşivi | “Reklam bulundu” ile “performansı iyi” ayrılır | Kütüphane görünürlüğü rakibin CTR/CPA/ROAS'ını vermez; API kapsamı ayrıca doğrulanmalı |
| P2 — Kreatif ve paket | Mevcut DAM/marka varlıkları, font/logo arşivi, deterministik HTML/banner renderer | Boyut, font, logo, yerleşim varyantı, link ve paketleme kodla | Daha az görsel yeniden üretimi; dosya/marka tutarlılığı | Lisanslı varlıklar; görsel/API görüntü üretimi gerekiyorsa hâlâ maliyetli |
| P2 — Etkileşim ve kalite | Mevcut widget olayları, GA4 veya seçilecek ürün analitiği | Başlama, tamamlama, terk, CTA olayları; otomatik link/layout kontrolleri | Fit-check/creative concept gerçekten kullanılıyor mu? | Consent ve doğru event şeması; event kaydı geçmiş davranışı geri getirmez |
| P3 — Persona/kayıt doğrulaması | İzin verilirse anonimleştirilmiş CRM/LMS kayıtları | Sektör/rol/kurs dağılımını SQL ile; AI hipotezleri yorumlar | Persona tahmini gerçek toplu kayıtla sınanır | Kullanıcının mevcut yalnız-açık-web sınırının DIŞINDA; şimdi bağlanmayacak |
| P2 — Editoryal kalite/öğrenme | Mevcut insan review, revizyon ve sonuç kayıtları | Geçer/revizyon gerekçeleri, düzeltme süresi, maliyet raporu kodla | Kullanılabilir çıktı başına maliyet ve tekrarlanan hata görünür | AI'nın kendi puanı doğruluk kanıtı değildir; uzman kontrolü gerekir |

Resmi referanslar: [Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [GA4 kotaları](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas), [Keyword Planning](https://developers.google.com/google-ads/api/docs/keyword-planning/overview), [LinkedIn Community Management](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview), [Semrush API koşulları](https://www.semrush.com/kb/5-api), [Brandwatch API](https://developers.brandwatch.com/docs/data-retrieval). Bunlar ürün/API kabiliyetlerini destekler; bizim uygulamamızdaki yetki veya çalışırlık doğrulaması değildir. SerpApi, Meta ve seçilecek CMS adapter'ları satın alma/uygulama öncesi endpoint düzeyinde ayrıca incelenmeli.

## 5. Önerilen yatırım sırası

1. Önce yeni abonelik almadan mevcut araştırma günlüğünü ve kullanım maliyetini göster. Motorların ölçülmediği açık olsun.
2. Site envanteri + Search Console + GA4. Araştırmaya gerçek ihtiyaç, mevcut içerik ve sonuç verisi kazandır.
3. Yetkili kendi LinkedIn/Instagram verisi; araştırma çıktısına kaynaklı sosyal dağıtım önerileri tasarla.
4. Küçük bir SERP/keyword veri pilotu seç. Başlangıçta Semrush, SerpApi ve DataForSEO'nun hepsini birden satın alma.
5. Sabit sorularla sınırlı motor baseline'ı; gerçek ihtiyaca göre kapsamı genişlet.
6. Sosyal dinleme ve hashtag ürününe ancak kendi hesap verisi ile açık webin çözemediği somut boşluk varsa yatırım yap.

B2B eğitim için LinkedIn önceliği **test edilecek ürün hipotezidir**; CROV'nin kanal performansıyla doğrulanmalıdır. Instagram'ı otomatik dışlamayalım, her konuya zorunlu da eklemeyelim.

## 6. Tasarrufu nasıl kanıtlarız?

AI toplama, sayma, sıralama, link kontrolü, dosya paketleme ve önceden bilinen bilgiyi tekrar okuma işlerinden çıkarılmalı. AI yorumlama, yaratıcı çerçeve ve yazımda kalmalı.

Aynı kurs/soru seti ve eşit kalite ölçütleriyle iki akışı karşılaştır:

- A: mevcut web-search + analiz.
- B: API'den yapılandırılmış veri + seçilmiş kanıtlar + analiz.

Ölç: ücretli sağlayıcı çağrısı, input/output token, harici API bedeli, abonelik payı, hata/tekrar, uzman düzeltme dakikası, kaynaklı iddia oranı, onaylanan kullanılabilir çıktı sayısı. Kalite kararını insan incelemesiyle ver.

**Kullanılabilir çıktı başına toplam maliyet = (LLM + veri API'si + abonelik payı + editör emeği + operasyon) / onaylanan kullanılabilir çıktı.** Payda sıfırsa oran raporlanmaz. Şu an veri/API bağlantıları için ölçülmüş bir tasarruf yüzdemiz yok.

Cache anahtarı label + kaynak + sorgu/ülke/dil + tarih kapsamı + şema sürümü olmalı. Önce izin/lisans ve tazelik sınırları. Hash değişmediyse tüm içeriği yeniden analiz etmek yerine önceki kanıtı kullan. Yeni veri/marka/kurs sürümü varsa ilgili bölümü yeniden incele. Mevcut GEO kaynak checkpoint'i yalnız aynı işin tekrarında tasarruf sağlar; bütün platforma yayılmış cache sistemi değildir.

## 7. Uygulamadan önce kabul ölçütleri

- Eski çalışmalara sahte motor yanıtı veya sahte sosyal bulgu eklenmez.
- Motor adı, model, yöntem ve zaman ayrı alanlardır; bilgi yoksa bilinmiyor.
- Sosyal paylaşım önerisi kanal gerekçesi, kaynak ve ölçüm planı içerir.
- Hashtag önerisi ölçülmüş hacim veya AI sıralama garantisi olarak gösterilmez.
- Gösterim/etkileşim, site oturumu, başvuru ve AI alıntılanması ayrı KPI'lardır.
- Yayın sonrası benchmark farkı tek başına nedensellik kanıtı sayılmaz; diğer değişiklikler ve dönemler kaydedilir.
- Bu rapordaki hiçbir yeni servis erişim verilmiş/kurulmuş kabul edilmez.

## Teknik takip: gerçek motor sonuçları

[Motorlarda doğrudan ölçüm araştırması](ai-engine-measurement-technical-tr.md): DataForSEO'nun ayrı ChatGPT/Gemini LLM Scraper uçları, Google AI Mode için SerpApi ve daha geniş kapsam için Bright Data incelendi. Önceki LLM Responses adayından farklı ürünlerdir; entegrasyon ve canlı hesap testi henüz yapılmadı.

### Uygulanan ilk bağlantı: Bright Data / ChatGPT (11 Eylül 2026)

AI Visibility ekranındaki ChatGPT modu, onaylanan soruları NL üzerinden sorgular.
Ham cevap metni ve kaynaklar analizden önce saklanır. Sonuç ekranında ChatGPT
cevabı, kaynaklara dayanan karşılaştırma ve kendi sayfamız/blog için taslaklar ayrı
sekmelerdedir. API ve worker için `BRIGHT_DATA_API_KEY` gerekir. Bright Data kullanım
bedeli mevcut AI kredi göstergesine dahil değildir; sağlayıcı panelinden izlenir.
Boş citation alanları bilinmiyor olarak kalır; eksik cevap marka yokluğu sayılmaz.
Ayrıntılar: [AI Visibility mimarisi](ai-visibility-architecture.md).

Canlı pilot: `241fcafb-38fb-4693-8dbb-6fdb67158ce3` işiyle tek CROV sorusu
Bright Data üzerinden başarıyla toplandı. Rapor:
`6282a1ed-8277-4486-8237-193e8b71d89c`. ChatGPT cevabı ve kaynakları saklandı;
sonraki OpenAI analiz çağrıları HTTP 429 döndüğü için karşılaştırma ve metin
önerileri henüz üretilmedi. Rapor geçmişte eksik analiz durumuyla tutulur.
429 yanıtından tek başına hız limiti/kredi kotası ayrımı yapılamaz. Tekrar deneme
kaydedilmiş ChatGPT cevabını kullanır; yeni Bright Data sorgusu satın almaz.
