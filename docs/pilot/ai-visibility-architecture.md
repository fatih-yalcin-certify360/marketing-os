# AI Visibility — platforma uyarlanmış ilk sürüm

2026-09-11. Uygulama sınırı: mevcut Fastify/React/PostgreSQL modüler monolit; label yetkileri, onaylı kurs/marka ve kampanya briefing kapıları korunur. Yeni servis, kimlik sistemi, otomatik yayın veya Course Truth'u AI cevabıyla değiştirme yok.

## Akış ve bilgi mimarisi

AI Visibility → İzleme ayarları → Önerilen sorular/onay → Sabit benchmark → Yanıt kaydı → Ölçümler ve ham kanıt → İncelenecek açık → Mevcut kampanya/briefing → Content Studio → İnsan değerlendirmesi. Gelecek tekrar ölçümlerinden otomatik nedensellik sonucu çıkarılmaz.

Sekmeler: Markalar, Sorular & benchmark, Ölçümler & kanıt. İlk MVP manuel başlayıp tamamlanabilen benchmark; zamanlayıcı ve izinli otomatik toplayıcı sonraki aşama. Asıl çalışan dikey dilim, veri boşken sahte yüzde göstermeyen ve içe alınmış gerçek yanıtları kampanyaya bağlayan akıştır.

## Veri modeli

- Entity: label altında marka/rakip, ad, alias, domain. Değişiklikler benchmark snapshot'ına etki etmez.
- Prompt: UUID, text/version, family, topic, intent, course, branded sınıfı, kaynak, persona bağlamı, proposed/approved. Onaylanan prompt değişmez; yeni metin yeni UUID ile eklenir (bu MVP sürüm soy ağacı kurmaz).
- Benchmark: ad, course, ülke/dil, sabit prompt kimlikleri ve motorlar, tekrar sayısı. Karşılaştırma bu sabit küme içinde yapılır.
- Run: benchmark, durum, tarih, sabit entity snapshot ve değiştirilemeyen onaylı prompt referansları; immutable observation hücreleri.
- Observation: run+prompt+engine+repeat unique; raw text, capture method, model/version biliniyorsa, session context, success/failure, source links, capturedAt, hash. Metadata JSON olabilir; ana iş nesneleri ilişkisel kolonlarda.
- Mention/citation: observation'a bağlı ayrı satırlar; eşleşen ad/alias/domain açıklaması; literal eşleşme, anlamsal analiz yok.
- Gap → campaign bağlantısı: observation ve kampanya kimliği. Kanıt, taslak suppliedBrief içinde korunur; normal briefing onayı gerekir.

## Adapter sözleşmesi

Engine tüketici ürününü/model hedefini; capture method kaydın nasıl elde edildiğini ifade eder. Manual import gerçek dış yanıtı normalize eder. Browser/API/third-party adapter aynı sözleşmeye uyar. Mevcut üretim API'si ChatGPT tüketici görünürlüğü sayılmaz. Desteklenmeyen otomatik adapter açık UNAVAILABLE döner. Kısıtları aşmak için fallback yok.

İlk sürüm: ChatGPT, Gemini, Perplexity, Copilot, Claude ve ayrı API-model hedefi için manuel kayıt. Otomatik browser sağlayıcıları etkin değil. Bu, 2–3 gerçek otomatik motor bağlandı anlamına gelmez. Resmi/izinli adapter bağlanınca mevcut job kuyruğu execution'a bağlanmalı; manuel import için yapay AI job/maliyet rezervasyonu oluşturulmaz.

## Metrikler

- Başarılı observations paydadır; failed/blocked/extraction-error ayrı gösterilir. Başarılı yanıt yoksa oran null/UNKNOWN.
- Branded ve unbranded ayrı. Unbranded ayrıca hedef ve rakip adı içermeyen generic discovery olarak gösterilir; rakip adı geçen alternatives generic discovery sayılmaz.
- Mention rate = marka adı/domain alias eşleşen başarılı cevaplar / başarılı cevaplar. Tekrarlı promptlar ayrı observations; unique prompt sayısı da gösterilir. Pazar payı değildir.
- Citation rate yalnız citation capture'ın complete olarak belirtildiği başarılı cevaplarda hesaplanır. Kaynaklar bilinmiyorsa kaynak yok varsayılmaz. URL bir citation olarak ayrıca kaydedilmeli; düz metindeki domain mention'ı citation değildir.
- SOV = gözlenen marka-varlığı sayısı / izlenen tüm entity-varlığı sayısı. Aynı cevapta çok marka olabilir; yalnız izlenen entity kümesine aittir.
- Recommendation, sentiment, liste pozisyonu, accuracy rate: ilk sürümde UNKNOWN. Adın ilk geçiş sırasını öneri sırası diye göstermeyiz. Daha sonra kanıtlı, ayrı değerlendirme gerekir.
- Trend: yalnız aynı benchmark/snapshot ve capture context karşılaştırılabilir. Gelecek model sürümü/kişiselleştirme farklılığı açıklanmalı; ilk sürüm geçmiş run'ları ayrı gösterir, nedensellik veya otomatik trend yorumu yapmaz.

## Prompt ve veri kalitesi

Kurs adından oluşturulan öneriler gerçek arama hacmi değildir. Öneriler insan onayı olmadan benchmark'a giremez. Normalize edilmiş birebir tekrar engellenir; token benzerliği uyarısı desteklenir, semantik embedding/cluster yokmuş gibi gösterilmez. Sayısal hacim UNKNOWN.

Entity eşleşmesi token sınırları, açık aliases ve domain hostlarıyla deterministik yapılır; belirsiz kısa adlar insan ayarı gerektirir. Eşleşme kanıtı tutulur, anlamsal marka çözümlemesi iddiası yok. Alias çakışmaları engellenir. Bir alan adının görülmesi o kaynağın cevaba neden olduğunu göstermez.

## Güvenlik / erişim

Tüm sorgular label ile sınırlı. research:read görüntüleme, research:run veri girişi, course:approve prompt onayı, campaign:write aksiyon. Ham yanıtlar HTML olarak çalıştırılmaz. Dış URL'ler otomatik fetch edilmez, yalnız HTTPS kaynak bağlantıları tutulur. İçe aktaran kullanıcı kişisel/gizli veri bulunmadığını teyit eder; bu sunucu tarafında istenir ve eksiksiz anonimleştirme garantisi değildir. E-posta gibi açık kişisel veri kalıpları reddedilir. Browser cookie veya sağlayıcı şifresi için alan yoktur; ham yanıtı göndermeden önce gizli bilgileri kullanıcı temizlemelidir. Bu kontrol DLP sistemi değildir.

## Sağlayıcı spike / belirsizlikler

- OpenAI Terms otomatik/programatik çıktı toplamayı kısıtlar: https://openai.com/policies/terms-of-use/ . Bu nedenle izinsiz ChatGPT browser scraper kurulmadı.
- Gemini temporary chats kişiselleştirmeyi azaltmaya yardımcı olur; bütün konum/model farklarını yok etmez: https://support.google.com/gemini/answer/13594961 . Tarayıcı dili gerçek konum garantisi değildir.
- Perplexity şartları ayrıca kontrol edilmeli: https://www.perplexity.ai/hub/legal/terms-of-service . Genel API erişimi tüketici ürünü eşdeğerliği kanıtlamaz.
- Tüketici browser otomasyonunu doğrulayan izinli spike henüz yapılmadı. İlk sürümde gerçek otomatik consumer measurement kapsamı 0; dashboard bu gerçeği saklamaz.

## Fazlar

1. Çalışan manuel benchmark, merkezi metrik, kaynak/yanıt drill-down, kampanya bağlantısı.
2. İzin ve sözleşmesi doğrulanmış 2–3 sağlayıcı; mevcut queue, rate limit, idempotency ve partial-result resume entegrasyonu.
3. Claim → onaylı kurs alanı karşılaştırması ve uzman accuracy review; recommendation sınıflaması.
4. GSC/SEO/Radar kaynaklı öneriler, semantik benzerlik/cluster, ölçülen talep.
5. Zamanlayıcı, karşılaştırılabilir baseline/after ve intervention çizelgesi.

Test: marka var/yok/alias, domain tuzakları, tekrar citation, hatalı yanıtın paydadan çıkarılması, boş örneklem, kaynak bilinmiyor, farklı markalama, label izolasyonu, prompt onayı, immutable hücre, provenance ve normal kampanya gate'leri.

## Çalışan ekran ve API

Sol menü: **AI Visibility**; adres /ai-visibility. Ekranlar aktif label'a bağlıdır.

1. Eigen merk ve Concurrent kayıtları; domain için örneğin cs-opleidingen.nl. Alias'larda farklı yazımlar kullanılır, aynı ad tekrarlanmaz. Ayarlar değiştirilebilir; eski benchmark entity snapshot'ı değişmez.
2. Opleiding seç → 24 öneri veya kendi sorunu ekle → ilgili soruları değerlendir/onayla → checkbox ile seç → motor/tekrar/ülke/dil/sesyon/arama modu belirle → Meetset vastleggen.
3. Nieuwe meetronde → gerçek üründe soruyu sor → açık hücreyi seç → tarih, tam yanıt, kaynaklar ve model biliniyorsa adını kaydet. Engellenen yanıtı blocked olarak kaydet. API-model kaydı model adı ister.
4. Metingen & bewijs: motor ve soru sınıfı filtresi, açık paydalar, ham yanıtlar ve JSON indirme. Onderzoek als campagne mevcut campaign service üzerinden normal taslak açar. Ham yanıt dış kaynak girdisidir; doğrulanmış kurs bilgisi sayılmaz.

GET /api/v1/labels/:labelId/ai-visibility: konfigürasyon, prompt, benchmark ve son 50 run listesi.
POST alt yollar: /entities, /entities/:id (konfigürasyon güncellemesi), /prompts, /proposals, /prompts/:id/approve, /benchmarks, /benchmarks/:id/runs, /runs/:id/observations, /runs/:id/campaigns. GET /runs/:id ham kanıt ve merkezi metrikleri döndürür. Tip/alan sınırları packages/contracts/src/ai-visibility.ts içinde.

run oluşturma requestKey ile idempotent; aynı hücreye aynı normalize edilmiş payload yeniden gönderilirse önceki kayıt döner. Değişik payload 409 verir. responseHash, yalnız metnin değil tüm normalize edilmiş import payload'ının SHA-256'sıdır. Observation kimliği ve kaynaklar export'a dahildir. Kampanya brief aktarımı metni 9.000 karakter ve linkleri ilk 10 ile sınırlar; tam kayıt orijinal run'da kalır. İçe aktarımın tam anonimleştirildiği otomatik kanıtlanmaz.

## Bilinçli olarak sonraki aşamada kalanlar

- Otomatik consumer/browser veya resmi API çağrısı, scheduler ve provider credentials bağlantısı. Bu sürüm import ekranıdır; motoru seçmek dış servise istek göndermez.
- Screenshot yükleme/depolama, otomatik CAPTCHA algılama ve servis sağlık kontrolleri. Şu an kullanıcı durum ve varsa açık kanıt URL'si kaydeder.
- Semantik persona/keyword keşfi, gerçek arama hacmi, accuracy/recommendation puanı ve otomatik trend dashboard'u.
- İnsan onayından bağımsız SEO veya AI görünürlük artışı garantisi.

Çalışan adapter çekirdeğine izinli otomasyonu eklemek sonraki adım; manuel ölçüm de her zaman ayrı capture method olarak kalmalı. Aynı benchmark içinde farklı API modelleri import edilirse model adı yanıt bazında görünür; motor toplamı homojen model deneyi sayılmamalı, karşılaştırma için sabit model kullanılmalı.

## Güncelleme: aktif label ile otomatik GEO araştırması (2026-09-11)

Önceki manuel ölçüm ekranı artık gelişmiş bölümde. Varsayılan akış:

**Aktif label → kurs → hazır soruları seç/düzenle → Vragen goedkeuren & onderzoek starten → kurs sayfası/blog önerileri → kayıtlı araştırmalar.**

- Label, uygulamanın aktif label seçicisinden gelir; marka/entity formu gerektirmez. Üç soru kurs adından ücretsiz önerilir; gerçek arama hacmi olarak sunulmaz.
- Kurs URL'si kayıtlı kurs kaynağından alınır. Eksik veya farklıysa bir kez girilir; label ve kurs sürümü bazında geo_course_settings içinde saklanır. URL değişimi Course Truth'u değiştirmez.
- Onay düğmesi seçili soruları, kursu ve URL'yi mevcut job kuyruğuna dondurulmuş payload olarak gönderir. research:run yetkisi gerekir; bu, kurs gerçeklerini onaylama veya yayın yetkisi değildir.
- geo.research worker handler önce mevcut sağlayıcının web search bağlantısını çalıştırır, sonra gerçek arama sonuçlarında doğrulanmış en fazla altı dış URL ve kurs sayfasını güvenli HTTP katmanıyla okur. Kullanıcı tarafından girilen özel ağ URL'leri reddedilir.
- Kaynaklar, seçili sorular ve güncel Brand Portal/marka kurallarıyla analiz edilir. Araştırma iddiaları ve yayın taslakları ayrı alanlardır; kurs iddiaları yalnız onaylı kurs gerçeklerinden türetilmelidir. Kaynak metinleri komut olarak çalıştırılmaz.
- Her önerinin alıntısı kaydedilmiş kaynak metninde doğrulanır. Doğrulanamayan alıntılar ayıklanır. Kanıtsız veya kursla ilgisiz bir soru için sayfa/blog taslağı sunulmaz. Kurs sayfası değişikliği ayrıca kurs sayfasından doğrulanmış bir alıntı gerektirir. Bu mekanik kontrol alıntının yorumu veya metnin bütün gerçekleri için uzman doğrulaması değildir.
- GEO önerisi; hedef bölüm, gerekçe, sayfaya eklenebilir metin ve uygun olduğunda ayrı blog başlığı/metni/iç bağlantı içerir. Blog konusu değer katmıyorsa blog null olabilir. Bunlar kullanıcı incelemesi gereken taslaklardır; mevcut kampanya ve yayın onaylarını atlayan otomatik yayın yoktur.
- Başarıyla okunan kaynaklar job'a bağlı geo_research_sources checkpoint'inde kalır. Analiz hatasında retry aramayı/okumayı tekrar etmez. Tamamlanan rapor job_id ile idempotent kaydedilir. Yeni araştırma yeni job/rapor oluşturur.
- Sonuçlar geo_reports içinde saklanır; **Bewaarde onderzoeken** bölümünde aktif label içinde kurs, soru veya içerik metniyle aranır (en son 100 eşleşme). Rapor URL parametresiyle yeniden açılabilir. Eski manuel ölçümler korunur.
- Markdown indirme sayfa/blog taslaklarını; JSON indirme soruları, kaynak metinlerini, URL'leri, hash/tarihleri, alıntıları, marka sürümünü ve job referansını içerir. Dış CMS'ye otomatik yazılmaz.

Bu işlem **web araştırması ve GEO içerik analizi**; ChatGPT/Gemini tüketici ürününde marka görünürlüğü, sıralama, arama hacmi veya GEO artışı ölçümü değildir. Manuel consumer ölçümleri ayrı veri modeli ve ekran olarak kalır. Tarayıcı scraper yoktur. Etkin sağlayıcı web search desteklemiyorsa başlatma açıkça engellenir. İki mantıksal AI adımı vardır; model düzeltme/teknik tekrarları ayrıca maliyet oluşturabilir. Bütçe rezervasyonu ve kullanım kaydı mevcut platform mekanizmasını kullanır.

Google'ın [AI features rehberi](https://developers.google.com/search/docs/appearance/ai-features) yararlı, güvenilir içerik ve temel SEO uygulamalarını esas alır. Bu nedenle özel bir “AI schema” veya garanti edilen görünürlük artışı önerilmez. Bu modül robots.txt, tüm site mimarisi, indekslenebilirlik, yapılandırılmış veri veya performans için tam teknik denetim yapmaz; en fazla 12.000 karakterlik okunabilir sayfa metinlerini inceler.

API: aynı label altındaki /ai-visibility/geo/setup/:courseVersionId, /start, /latest/:courseVersionId, /reports?search= ve /reports/:id. Eski manuel endpoint'ler değişmedi.

## Bright Data ChatGPT pilot — 2026-09-11

The GEO form now supports `mode: chatgpt` alongside the backward-compatible
`web_research` default. Configure `BRIGHT_DATA_API_KEY` in the server environment
(API and worker); the key never goes to the browser. No extra OpenAI credential
is required for capture. Existing generation credentials still power analysis.

Flow: approve exact questions → collect ChatGPT answers through Bright Data →
read the own course page and up to six returned source URLs → compare evidence →
brand-aware page/blog drafts. The provider receives only the approved questions,
NL country, ChatGPT URL and web-search permission; no brand priming or course facts.

`0020_geo_engine_captures.sql` checkpoints the request before dispatch, stores any
provider snapshot ID, and persists normalized original answer text and separate
citation/search/attached-link records before analysis. HTML is neither rendered
nor saved. Job retries reuse captured results or poll the existing snapshot.
An ambiguous submission with no snapshot ID is not automatically purchased again.
Question matching is exact, errors are not brand absences, absent model/citations
remain unknown. Original provider HTML and complete raw payloads are not retained.

The label-scoped `/geo/answers/:jobId` endpoint exposes answers even if later
analysis fails. Completed reports include `engineAnswers`, are searchable through
existing report history and downloadable as JSON. When the analysis fails after capture, a partial report is saved in history and
updated in place on retry. Requests that fail before usable capture remain in the
latest-job view; a comprehensive failed-request history is not yet built.
The result tabs separate ChatGPT answers, comparisons, page/blog drafts and sources.

Limits: one engine (ChatGPT), NL only, up to five questions per run, no general
ranking claims, source reading capped at seven pages × 12,000 characters. Exact
label-name matching is not an alias-aware visibility metric. External sources may
be competitors, registers or other references. A current brand profile is required
for drafting. Drafts still need editorial review; nothing is published to the CMS.
Bright Data charges/credits are separate from the current AI usage ledger; the UI
says this explicitly. Check provider spend limits/credit balance in its dashboard.

Provider contract: https://docs.brightdata.com/api-reference/scrapers/ai-search-apis/chatgpt-search-by-prompt
Snapshot polling: https://docs.brightdata.com/api-reference/web-scraper-api/management-apis/monitor-progress
