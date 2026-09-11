# CROV pilotu: pazar sinyalinden yaratıcı işe

> Sonraki ürün aşaması: [Rakip araştırmasından indirilebilir kampanya paketine](market-to-campaign-plan-tr.md). Persona/keyword araştırması, blog ve interaktif banner/site teslimleri bu bağlantıda planlanmıştır; aşağıdaki çalışan radarın mevcut kabiliyetleriyle karıştırılmamalıdır.

10 Eylül 2026 — Marktradar MVP uygulandı; `/radar` üzerinden kullanılabilir. Bu belgenin ilk örnek kartları asistanın editoryal araştırmasıdır. Uygulamanın gerçek API ile ürettiği taramalar ve doğrulama kayıtları aşağıdaki “Uygulama durumu” bölümündedir.

## Ürün vaadi

Pazarlamacı kursunu seçer; araç ilgili kaynakları ve rakip adaylarını bulur, kanıtlarını gösterir, neden önemli olduklarını açıklar ve seçilen bulgudan marka bağlamını koruyan yaratıcı bir çalışma başlatır.

İlk kullanımda değer: boş bir brief ekranı yerine incelenebilir fırsatlar ve referans materyalleri. Sonraki kullanımlarda değer: yeni veya değişmiş bulguların tekrar taramada ayrılması ve kullanılan fikirlerin geçmişi.

## Tek kullanıcı akışı

1. CS Opleidingen / CROV seç → **Scan de markt**.
2. Kaynak adayları: eğitim sağlayıcısı, aynı kitleye ulaşan kuruluş, resmî veri kaynağı. Rakip sınıflandırması gerekçeli ve düzeltilebilir.
3. Az sayıda anlamlı sinyal kartı: ne bulundu, kanıt, kaynak bağlantısı, erişim tarihi, varsa yayın tarihi/veri dönemi, CROV ile ilişkisi, önerilen aksiyon, belirsizlik.
4. Referans panosu: rakip sayfası veya doğrulanmış reklam; görsel önizleme, mesaj, CTA, format ve orijinal bağlantı. Web sayfası görseli reklam diye etiketlenmez.
5. **Maak hier een campagne van** → seçili kanıtlarla üç farklı yaratıcı yaklaşım; kullanıcı birini seçer.
6. Mevcut brief ve üretim akışına geç: kaynaklar, hedef kitle, öneri ve CTA taşınır. Metin, carousel senaryosu veya landing-page bölümü hazırlanır; düzenleme ve export tamamlanır. Kanal desteği ayrıca doğrulanmalıdır.

## Gerçek kaynaklarla pilot kartlar

### 1. Başlamadan önce deneyimleme

- Gözlem: NHA'nın aynı başlıklı eğitim sayfasında proefles ve 15 günlük deneme çağrıları var. Diploma NHA-instituutsdiploma olarak belirtiliyor; CS eğitimiyle eşdeğerlik varsayılmamalı.
- Kaynak: https://www.nha.nl/beroepsopleidingen/hrm/casemanager-regie-op-verzuim
- Tür: alternatif eğitim sağlayıcısının web sayfası; aktif reklam doğrulanmadı. Yayın tarihi bilinmiyor; bu hafta başlayan kampanya denemez.
- Yorum: Kullanıcıya eğitim deneyimini önceden tattırma, test edilebilir bir iletişim yaklaşımı.
- CROV fikri: **Welke vraag stel jij eerst?** Üç kartlık kısa, kurgusal iş durumu; ardından CROV programına geçiş. Kurs uzmanının kontrol edeceği örnek; var olmayan ücretsiz ders veya değerlendirme hizmeti vaat edilmez.
- Deneme: standart program tanıtımıyla bu yaklaşımın hedef sayfaya geçişini karşılaştır. Sonuç henüz yok.

### 2. Meslek kimliği ve kariyer geçişi

- Gözlem: Robidus başlangıç, kariyer değişimi ve deneyim rotalarını ayırıyor; altı soruluk meslek testi sunuyor.
- Kaynak: https://werkenbijrobidus.nl/casemanagement/
- Tür: işe alım sayfası; aynı aday kitlesine ulaşan kuruluş. Haricî kurs rakibi veya doğrulanmış reklam değil.
- Yorum: Program modülleri yanında adayın “bu iş bana uygun mu?” sorusunu ele almak denenebilir.
- CROV fikri: **Wat neem jij vanuit HR mee naar casemanagement?** Önceki deneyimle yeni öğrenme ihtiyacını bağlayan carousel veya öz değerlendirme içeriği. Robidus testi, tanıklıkları ve eğitim vaatleri CS'ye aktarılmaz.

### 3. Yanlış rakip eşleştirmesini önleme

- Gözlem: Resmî CS sayfası Scolea Verzuimspecialist CROV eğitiminin 12 Eylül 2025 itibarıyla CS Opleidingen'e dahil edildiğini söylüyor.
- Kaynak: https://cs-opleidingen.nl/opleidingen/regie-op-verzuim/scolea
- Sonuç: Bu eğitim bağlamında Scolea bağımsız rakip olarak listelenmemeli. Eski broşür sonuçları güncel rakip teklifi sayılmamalı.
- Yaratıcı kullanım: İsim geçişini açıklayan FAQ içeriği adayı yönlendirebilir. Gerçek aday karışıklığı veya arama hacmi henüz ölçülmedi.

## Başlangıçtaki kod durumu ve uygulama hedefleri

Başlangıçta vardı: sources-research kayıtlı kaynakları okuyor, araştırma çalıştırmalarını ve alıntıların dayanağını saklıyor. Kurs/marka bağlamı, persona, fırsat, brief, içerik ve versiyon akışları var.

Başlangıçta eksikti (güncel durum aşağıda): sources-research otomatik kaynak keşfi yapmıyor. OpportunityService.propose bağlamında kurs, marka ve personalar var; seçili piyasa sinyalleri doğrudan yok. Rakip/reklam panosu ve sinyalden kampanyaya bağ henüz kurulmalı.

İçerik tesliminde önceki kontrolde bulunan CTA URL kaybı bu akışın da öncelikli düzeltmesi.

## Bir haftalık uygulama sırası

| Gün | Somut teslim |
| --- | --- |
| 1 | Gerçek arama sağlayıcısı erişimini doğrula, CROV için kaynak keşfi ve sınıflandırma denemesi. Erişim yoksa açıkça etiketlenen kayıtlı kaynak taraması; otomatik keşif diye sunulmaz. |
| 2 | Kaynaklı sinyal kaydı, yinelenen bulguların ayıklanması, erişilemeyen kaynakların görünmesi. |
| 3 | Radar ekranı ve kaynak/sayfa görseli panosu. Reklamlar için orijinal reklam bağlantısı veya kullanıcı eklemesi; otomatik reklam erişimi doğrulanmadan vaat edilmez. |
| 4 | Sinyali seç → üç farklı yaklaşım → mevcut brief; kaynak kimlikleri ve CTA korunur. |
| 5 | CROV için gerçekten kullanılacak içerik teslimi; kurs uzmanı/pazarlamacı değerlendirmesi. |
| 6 | Tekrar tarama, yanlış eşleştirme, eski veri, boş sonuç ve export kontrolleri; demo provası. |
| 7 | Canlı akış ve önceden kaydedilmiş gerçek çalışma yedeğiyle sunum. |

Bu bir hedef sıralamasıdır; arama ve reklam erişimi teknik denemeden geçmeden tam otomatik kapsam taahhüdü değildir. İlk hafta birkaç ilgili kuruluş ve sınırlı kaynak kümesi yeterli; sürekli tüm internet taraması kapsam dışı.

## Kabul ölçütleri ve demo

- Kart başına açılabilen kaynak ve dayanak; gözlem ile yaratıcı yorum ayrı.
- Kaynak tarihi ile tarama tarihi ayrı; yeni bulundu diye yeni yayımlandı denmez.
- Scolea örneğinde ilişkiyi doğru ayır; rakip fiyat/vaatleri CS kurs bilgilerine karışmasın.
- En az bir seçili sinyal üretimin briefinde ve tesliminde izlenebilsin.
- Pazarlamacı en az bir fırsatı uygulanabilir bulsun ve içerik için gereken düzeltmeleri kaydetsin.
- Ölçüm: yararlı bulunan sinyaller / gösterilen sinyaller; inceleme ve üretim süresi; gerekli editler. Reklam harcaması, başarı skoru veya satış artışı uydurulmaz.

Demo: kursu seç → gerçek taramayı aç → bir rakip eşleştirmesinin gerekçesine bak → kaynak ve görsel referansı incele → fırsatı seç → yaratıcı yaklaşımı seç → düzenlenebilir teslimi göster.

Sunum cümlesi (NL): “Deze tool helpt ons relevante marktinformatie te vinden, te beoordelen en om te zetten in een onderbouwd creatief voorstel voor onze eigen opleiding.”

## Uygulama durumu — 10 Eylül 2026

Marktradar artık `/radar` ekranında bağlı. OpenAI ile gerçek kaynak keşfi,
bağımsız sayfa okuma, alıntı kontrolü, fırsat kartları, kaynak görselleri, tarama
geçmişi ve seçilen yaratıcı yönü yeni kampanyaya taşıma uygulanmıştır. Erişilemeyen
kaynaklar gerekçeleriyle gösterilir. Yenilemede çalışan tarama izlenebilir.

İlk gerçek CROV çalıştırması `e881c100-e1f4-4206-9fe8-c9af317dc97d`: altı kaynaklı
kart, iki erişim sorunu, dört kullanılabilir görsel önizleme. İlk çalıştırmanın
rakip ağırlıklı sonuçları üzerine kaynak çeşitliliği ve yaratıcı yönlendirme
promptları v2'ye çıkarıldı. Bu kayıt artık uygulamada gerçek API ile üretilmiş
bir sonuçtur; yukarıdaki editoryal örnek araştırmadan ayrıdır.

Reklam araştırması ayrı bir panelde uygulandı: Google kursun alan adına göre,
Meta ve LinkedIn kurs anahtar kelimesine göre taranır. Reklam metni, kütüphane
linki, ekran görüntüsü ve gözlem durumu saklanır. Web sayfası görselleri ayrı
kalır; aktif reklam kanıtı olarak sunulmaz. Mevcut onay adımları
korunur; radardan kampanya oluşturmak içerik yayınlamak veya onaylamak değildir.

İkinci gerçek tarama (v2): `2b310804-80fc-4539-92c1-66eddde13c41` — beş
kaynaklı kart. Scolea geçiş sayfası bağımsız rakip yerine `own_brand` olarak
sınıflandırıldı. Erişilemeyen bir kaynak ayrıca gösterildi. Bu taramadan
“De leidinggevende wil details” yaklaşımı tarayıcı üzerinden seçilerek
`7be3dcdb-7a54-4bfa-bfbf-65f61b0fc03f` numaralı CROV taslak kampanyası oluşturuldu;
kaynak URL'si, alıntı ve seçilen yaratıcı yönün korunması kontrol edildi.

Doğrulama: genel kontrolde 433 test ve tüm build'ler geçti. Son eklenen CTA
regresyonu dahil 42 odaklı test, typecheck ve lint ayrıca geçti; son build de
başarılı. Masaüstünde kaynak görselleri açıldı, 390 px görünümde yatay taşma
yoktu. Tarama sırasında sayfa yenilendiğinde ilerleme korundu. Bu teknik
kontroller içerik performansını veya kullanıcı değerlendirmesini kanıtlamaz.


## Reklam araştırması — canlı doğrulama (10 Eylül 2026)

Yeni rapor: `1b16eeb2-643b-48ee-8709-0a0880246115`.
İş: `6690abc8-c38f-4dfc-be3c-fce6511109d9`, ilk denemede başarılı.
4 kaynaklı fırsat ve ekran görüntüsü bulunan 16 reklam kaydedildi:

- Google: CS Opleidingen alan adındaki ilk 40 görünür kayıt incelendi; CROV
  veya Casemanager Regie op Verzuim metniyle eşleşen 8 kayıt saklandı.
  Güncel aktiflik çıkarımı yapılmadı; erişilebilen ilk/son gösterim bilgisi ayrıdır.
- Meta: CROV sorgusundaki 34 görünür kayıt incelendi; Capabel Hogeschool ve
  SV Land dahil 8 eşleşme saklandı. Aktif/pasif durumu kütüphane metninden alınır.
  Facebook/Instagram yerleşimleri ayrı ayrı doğrulanmış kabul edilmez.
- LinkedIn: otomatik erişim engellendi. Reklam bulunmadığı sonucuna varılmadı;
  orijinal arama bağlantısı kullanıcıya sunuluyor.

Bunlar sınırlandırılmış örneklemlerdir, bütün reklamların envanteri değildir.
Reklamlar web sayfası görsellerinden ayrı paneldedir. Platform filtresi,
önce dört örnek gösterimi, tümünü açma, kaynak metni ve orijinal reklam linki
kullanılabilir. Reklamdan kampanya taslağı oluşturma gerçek arayüzde denendi:
`6f3aaa6b-fb0d-4048-be10-cadc5ed432f3`. Kaynak reklam bağlantısı korunuyor;
CTA CS Opleidingen'in kendi CROV sayfasında kalıyor. Henüz yayın/onay verilmedi.

Doğrulama: tam `npm run verify` (444 test) geçti; sonrasında eklenen kısmi analiz
hatası kontrolleri dahil ilgili 28 test de geçti. Son typecheck/lint/build ve
masaüstü/mobil arayüz kontrolleri tamamlandı; mobilde yatay taşma veya tarayıcı
JavaScript hatası görülmedi. Yüklenen dört önizleme ve 16 kayıtlı PNG doğrulandı.
Önceki taramada 4096 token sınırında kesilen analiz için daha kısa, en fazla dört
kartlık istem kullanılıyor. Geçersiz analiz yanıtı reklam araştırmasını engellemez;
rapor bu eksikliği açıkça belirtir. Yetki ve diğer hatalar normal iş politikasına uyar.

Yerel kurulumda worker için `npx playwright install chromium` gerekir;
Linux bağımlılıkları için `--with-deps` kullanılabilir. API ve worker aynı
`STORAGE_ROOT` dizinini paylaşmalıdır. Mevcut Docker imajları Chromium sağlamaz;
konteyner dağıtımında tarayıcı ve Playwright çalışma zamanı ayrıca hazırlanmalıdır.
