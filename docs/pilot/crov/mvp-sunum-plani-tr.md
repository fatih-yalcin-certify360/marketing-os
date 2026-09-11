# Bir haftalık MVP: CROV için kaynaklı içerik üretimi

> Öncelikli güncel plan: [Kalite ve değer kanıtı](quality-and-value-proof-tr.md). Sunum iddiası kaynak/karar izlenebilirliği ve kontrol edilebilir teslimdir; kalite üstünlüğü ve maliyet tasarrufu karşılaştırmalı pilotla ölçülecek.

> Güncel kapsam — 10 Eylül 2026: Açık webden rakip/meslek araştırması, kaynaklı persona, arama niyeti ve seçilebilir interaktif kampanya paketleri için [ayrıntılı uygulama ve öncelik planı](market-to-campaign-plan-tr.md). Aşağıdaki metin önceki sunum planının kaydıdır.

> Kapsam güncellemesi — 10 Eylül 2026: Kullanıcı içerik üretiminden önce pazar keşfi, rakip materyalleri ve sinyalden yaratıcı fikre geçiş istedi. Güncel MVP önerisi [market-radar-mvp-tr.md](market-radar-mvp-tr.md). Bu dosya önceki dar öneriyi ve içerik teslimindeki bilinen eksikleri kaydeder; güncel ürün kapsamı değildir.

Çalışma varsayımı: sunumda çalışan tool ve somut içerik birlikte gösterilecek. Kesin sunum tarihi henüz belirtilmedi; günler bugünden itibaren göreli sıralanmıştır.

## Sunumda kanıtlayacağımız tek vaat

“Bir kursun doğrulanmış bilgilerini ve marka kurallarını, pazarlamacının kontrol edip düzenleyebileceği tutarlı bir içerik paketine dönüştürüyoruz.”

Başarı: CROV için içerik sahibinin az veya net olarak tanımlanmış düzenlemelerle kullanabileceği bir LinkedIn metni, bir Facebook uyarlaması ve kaynak/onay geçmişi olan bir teslim paketi.

## Bugünkü gerçek durum

10 Eylül 2026 yerel API kontrolü:
- CROV kurs kartı v2 onaylı. Fiyat ve program gibi alanlar kaynaklı; başlangıç tarihleri bilinmiyor.
- Brand Portal bağlantısı ve onaylı marka profili var. Bağlantı olması, portalda tüm yazım yönergelerinin bulunduğu anlamına gelmiyor.
- 0344e05b-8129-4e89-af6d-e3220149cd1b kampanyasında LinkedIn taslağı var; metin program sıralamasına ağırlık veriyor, CTA URL boş.
- Önceki CS CROV Discovery kampanyasında onaylanmış LinkedIn/Facebook içerikleri var; CTA URL'leri yine boş. Bu yüzden yayınlanabilir paket kapısı geçilmiyor.
- Bazı brief kontrol notları “marka kuralları/kanallar sunulmadı” diyor. Gerçekte eksik olanla modelin bağlamı yanlış yorumladığı noktayı ayırmak gerekiyor.
- Bu klasördeki yeni metinler editoryal referanstır. Bunları tool'un ham çıktısı gibi sunmamalıyız.

## MVP kapsamı

Tut:
- Tek label: CS Opleidingen.
- Tek kurs: CROV.
- Bir ana hedef kitle: HRM çalışanları; kullanıcıyla netleştirilecek.
- Tek kampanya ve açık brief.
- LinkedIn ana metni + Facebook uyarlaması.
- Kaynaklar, insan düzeltmesi, versiyonlama ve onay.
- Çalışan dışa aktarım ve önceden hazırlanmış demo yedeği.

Sunum sonrası:
- Yeni görsel modelleri, daha fazla tasarım ve otomatik estetik puanlama.
- Yeni kanallar, e-posta otomasyonları, takvim ve yayınlama entegrasyonları.
- Çok sayıda kursu aynı anda işleme.
- Henüz ölçülmeyen ROI ve dönüşüm vaatleri.

## Öncelikli üç teknik iş

P0 — CTA bağlantısını uçtan uca koru:
Onaylı briefteki hedef URL içerik üretimine ve çıktıdaki ctaUrl alanına ulaşmalı. Modelin bilinen URL'yi boş bırakması sessizce teslim edilmemeli. Onaylı hedef yoksa kullanıcıya açık eksik alan gösterilmeli. Regresyon testi: brief → içerik → export.

P0 — Brief sadakati ve odaklı metin:
Seçilen hedef kitleyi ve kampanya hedefini koru. Metin bir probleme/invalshoeke odaklansın; tüm kurs kartını yeniden yazmasın. Geçerli kaynak bilgisi ile yaratıcı kampanya tercihleri ayrılmalı. Yersiz kontrol notlarının bağlam eksikliğinden mi yoksa prompttan mı geldiği incelenecek.

P0 — Sunulabilir tek akış:
Kurs → brief → hedef kitle → içerik → düzenleme → onay → export yolunu tek bir demo kampanyasında tamamla. Mevcut içerikler ve kullanıcı onayları izinsiz değiştirilmeden yeni taslak sürümlerle ilerle. Üretim takılırsa önceki hazır paket gösterilebilmeli.

## Günlük çalışma planı

| Gün | Çıktı | Bitti sayılma koşulu |
|---|---|---|
| 1 | CROV içerik hedefi ve kalite referansı | İçerik sahibi, hedef kitle ve beklenen teslim seçilmiş |
| 2 | CTA ve brief bağlamındaki P0 düzeltmeleri | Link kaybolmuyor; hedef ve kanal korunuyor |
| 3 | Aynı kısa brieften üç bağımsız metin üretimi | İyi sonuç tek şanslı örnek değil; tüm çıktılar kaydedilmiş |
| 4 | İçerik sahibinin değerlendirmesi | Gerekli düzeltmeler ve nedenleri kaydedilmiş |
| 5 | Düzeltilmiş içerik + onay + export | Bir tam teslim paketi açılıp okunabiliyor |
| 6 | Baştan sona demo provası | Hatalar giderilmiş; hazır paket ve ekran kaydı yedeği var |
| 7 | Kısa sunum | 5–7 dakikada çıktı, işleyiş ve ölçülen bulgular gösteriliyor |

## Kaliteyi nasıl savunacağız?

Pazarlamacı ve mümkünse kurs uzmanı, araç adını görmeden metni değerlendirsin:

1. Kurs hakkında yazılan her olgu kaynakla uyuşuyor mu?
2. Seçilen hedef kitle ve brief amacı korunmuş mu?
3. Açılış belirli ve ilgili mi?
4. Metin tek bir fikir etrafında mı?
5. CS adına yayınlamak için hangi düzeltmeler gerekiyor?
6. CTA, hedef URL ve kanal biçimi tamam mı?

Kabul hedefi: sıfır dayanaksız eğitim iddiası, çalışan hedef URL, korunmuş brief amacı ve içerik sahibinin kaydettiği onay. “Kaliteli” olduğuna yalnızca asistan puan vermemeli.

Tutarlılık kontrolü: aynı briefle üç ayrı üretim; her birinde iddia hataları, hedef sapması ve gerekli editler kaydedilsin. Bu küçük pilot genel performansı kanıtlamaz, ama bariz tutarsızlığı ortaya çıkarır.

## İş değerini nasıl ölçeceğiz?

Aynı kurs ve aynı teslim tanımıyla:
- Normal yöntem: kaynak hazırlama, ilk taslak, inceleme/düzeltme süreleri.
- Tool: aynı üç süre; model bekleme süresi ayrıca.
- Her iki sonuç için aynı insan kalite değerlendirmesi.
- Tool tarafında gerçek çağrı sayısı ve uygulamada kaydedilmiş kullanım. Fiyatlandırma kayıtlarını fatura gibi sunma.
- İnsan emeği azalırken kalite korunuyor mu? Henüz ölçüm yoksa tasarruf yüzdesi verme.

Tek bir başarılı demo satış/inscription artışını kanıtlamaz. İlk iş değeri, kurumsal bağlamı tekrar kullanmak ve içerik hazırlama/inceleme işini daha izlenebilir yapmak olarak sunulmalı.

## 5–7 dakikalık demo

0:00–1:00 — Bitmiş metni göster. Hangi kurs, kime yönelik, okuyucudan hangi eylem bekleniyor?
1:00–2:00 — Kaynaklı kurs kartını ve onaylı marka profilini aç.
2:00–3:00 — Kullanıcı briefi ile yapılandırılmış sürümü karşılaştır; hedefin korunduğunu göster.
3:00–4:00 — İçerikteki iki kurs iddiasının dayanağını göster. Bir eksik bilginin uydurulmadığını göster.
4:00–5:00 — Bir cümleyi düzenle; yeni sürümü ve önceki sürümü göster.
5:00–6:00 — İnsan onayı ve dışa aktarımı göster. Onay düğmesine sen karar vermeden basma.
6:00–7:00 — Ölçülen edit süresi/tutarlılık bulguları ve bir sonraki dar pilot.

Sunumun açılış cümlesi (NL):
“Vandaag laat ik zien hoe we voor één echte opleiding van gecontroleerde informatie naar een beoordeelbaar contentpakket gaan. Ik toon de output, de bronnen en de menselijke keuzes die nodig blijven.”

“Bunu ChatGPT ile de yapamaz mıyız?” yanıtı (NL):
“Een losse tekst kun je ook met ChatGPT maken. De waarde van deze tool zit in de vaste opleidingscontext, de koppeling met onze merkregels en het bewaren van versies en goedkeuringen. Of dat ons ook tijd bespaart, meten we in deze pilot.”

Sunum sonunda istenecek karar (NL):
“Willen we dit met één contentverantwoordelijke op CROV verder toetsen, met vooraf afgesproken kwaliteitseisen en een vergelijking van de benodigde redactietijd?”

## İlk somut teslim

contentpakket-nl.md dosyası: iki metin, kaynak/iddia kontrolü, eski-yeni değerlendirmesi.
Sonraki adım: bu referansın tool içinde tekrarlanabilir biçimde üretilebilmesi için yukarıdaki üç P0 işini tamamlamak.

## Güncel demo akışı: sorudan kullanılabilir pakete

1. **Marktradar → CROV** seç. Soru araştırmasını ve istediğin teslimleri işaretle: blog/FAQ, seçim rehberi, site banner’ı. Reklam araştırması da ayrı seçilebilir.
2. Kaynaklar arasında **CS (kendi markamız)** ve **Capabel/SV Land (rakipler)** ayrımını göster. Reklam bulunmaması ile platform erişiminin engellenmesinin farklı durumlar olduğunu açıkla.
3. “Vragen, zoekvoorstellen en conceptpakket” bölümünde bir sorunun **literal kaynak sorusu** mu, **arama hipotezi** mi olduğunu göster. Alıntıyı açıp kaynağa git. Hacim verisi olmadığı için popülerlik iddiasında bulunma.
4. Önce bir hedef kitle/karar sorusunu seç: kim için olduğu, iş yanında planlama veya içerik karşılaştırması. “Maak campagne rond deze vraag” düğmesi bunun kaynaklı kampanya başlangıcını sağlar.
5. Radar paketindeki metinleri kontrol et; ZIP’te istediğin teslimleri bırak. Blogu ve seçim rehberini yerel tarayıcıda aç. Rehberde üç cevap seçip açıklamaları göster; sonuç bir puan veya kabul kararı değildir.
6. Sunumdaki değer önerisi: **“Kaynak araştırmasını, test edilebilir bir içerik fikrine ve elle kurulması gerekmeyen bir web taslağına dönüştürüyoruz. Varsayımları kanıtlardan ayrı tutuyoruz.”**

Sınırları doğru anlat: bu teslim bir **konsept paketidir**; yayın onayı ve marka tasarımı kontrol edilir. Sosyal içerik mevcut kampanya/onay akışındadır. Site banner’ı Google Ads/Studio reklam ZIP’i değildir. Google sorgu hacmi ve PAA/Autocomplete entegrasyonu henüz yoktur. Tamamen otomatik yayın veya kanıtlanmış kampanya performansı vaat edilmez.


## Güncel sunum sırası (önceki radar-paket demosunun yerine)

1. Radarda rakip/soru/rol bulgusunu aç, kaynağını göster ve kampanya oluştur.
2. Kampanyaya özel persona ve brief’i üret; kullanıcı brief’i kontrol edip onaylasın.
3. “Welke content past bij deze briefing?” ile gerekçeli önerileri al. Örneğin mevcut organik CROV brief’i blog ve seçim rehberi önerir, ücretli banner önermez.
4. Önerilen formatlardan seçim yap. Sosyal görsel için aynı kampanyanın mevcut sosyal içerik yolunu aç; web/Studio paketi için “Maak gekozen campagnepakket” kullan.
5. Güncel marka sürümünü göster; ZIP’te logo/font/CSS ve brief kimliğini aç. Marka veya brief değişirse eski indirme engellenir.
6. Google Studio örneğini ayrı anlat: üç boyut, mikro etkileşim, Enabler exit ve counters, ayrı yükleme ZIP’leri. Platform QA’sı yapılmadıysa “Google onaylı” deme.
