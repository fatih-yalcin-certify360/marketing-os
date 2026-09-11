# CROV MVP: kaliteyi ve değeri nasıl kanıtlayacağız?

10 Eylül 2026. Bu inceleme mevcut kod, üretim akışı, testler ve aşağıdaki birincil kaynaklara dayanır. İnsan içerik değerlendirmesi, hedef kitle testi veya dönüşüm deneyi yapılmış gibi sunulmaz.

## Ana karar

Sunum iddiamız: **“Kaynaklı bir fırsatı, kontrol edilebilir bir kampanya paketine dönüştüren ve editörün kararını kayıt altına alan çalışma alanı.”**

Henüz savunamayacağımız iddia: “AI en iyi içeriği üretiyor”, “SEO başarısı sağlıyor”, “kayıtları artırıyor” veya ölçmeden “maliyeti yüzde X azaltıyor”. Yazılım testlerinin geçmesi bu iddiaları doğrulamaz.

Öncelik daha fazla içerik türü değil: **bir hedef kitle kararı, bir güçlü ana içerik, açık kaynak izi, uzman değerlendirmesi ve aynı iş için karşılaştırmalı maliyet.**

## Mevcut yapıda gördüklerim

| Katman | Bugün gösterebildiğimiz | Açık kalan nokta / sonucu |
|---|---|---|
| Kurs ve marka | Onaylı kurs/marka sürümleri, gerçek logo/fontlar ve güncellik kontrolleri | CS metinsel marka kuralları eksikse tonu doğruladığımızı söyleyemeyiz. Bu boşluk portalda kapatılmalı. |
| Radar | URL, kaynak pasajı, alınma tarihi, rakip/öz marka ayrımı, reklam erişim sınırlamaları | Pasajı bulmak, yorumun doğru veya pazarın temsil edici olduğunu göstermez. Bulunamayan reklam “reklam yok” anlamına gelmez. |
| Persona | Kurs bağlamı, kaynak dayanakları ve varsayımlar | Kamuya açık iş ilanı veya kurs sayfası gerçek satın alma motivasyonunu ya da sektör payını kanıtlamaz. Personaları araştırma hipotezi olarak kullan. |
| Fırsat | Kaydedilen kart, yaratıcı yön ve kampanyaya taşınan kaynak | Popüler görünmek, değerli fırsat olmak değildir. Çözülen kullanıcı işi açık olmalı. |
| Briefing | Hedef, mesaj, kapsam, kanal, CTA, kullanılabilir iddialar, onay | Onay bir kişinin kararıdır; hedef kitle testinin yerine geçmez. Onaylı brief yanlış odaklıysa içerik de yanlış odaklanır. |
| Paket üretimi | Seçilen formatlar, öneri gerekçesi, hipotez, kaynak/brief/marka sürümü | Sabit şema bazı seçilmeyen alanları da ürettiriyor. Seçim bazında şema ve parça üretimi sonraki maliyet iyileştirmesi. |
| İçerik doğruluğu | Kaynak kimliği kontrolleri ve izin verilen kendi kurs bilgileri | Her cümle için kaynak ilişkisi ve anlam doğrulaması yok. Kaynaklı bir metin yine de yanlış yorum içerebilir. |
| Kreatif | Markalı şablonlar, boyutlar ve etkileşim motoru | Teknik olarak çalışan bannerın özgün/etkili olduğunu bilmiyoruz. Dosyayı gerçek boyutunda incelemek ve hedef kullanıcıyla denemek gerekir. |
| İnceleme | Sosyal içerikte mevcut edit/review; bu değişiklikle paketlerde kayıtlı insan değerlendirmesi | Paket içeriğini Studio içinde parça parça düzenleme ve yeni editoryal sürüm oluşturma henüz yok. “Düzeltilmesi gerekiyor” kaydı otomatik düzeltme yapmaz. |
| Ölçüm | Kullanım/job altyapısı; yeni değerlendirmede karşılaştırma ve isteğe bağlı süre kaydı | GA4/GSC bağlantısı ve sonuç döngüsü yok. Kullanıcının yazdığı süre otomatik telemetri değildir. |

İnceleme sırasında yerel veritabanında 8 paket/öneri kaydı, bunların içinde 4 üretim kaydı ve toplam 2 radar bağlantılı kayıt vardı. Bu anlık sayım bir kalite örneklemi değildir; bağlantısız paketler için pazar araştırmasına dayanıyor diyemeyeceğimizi gösterir. Veri değiştikçe sayı değişir.

## Araştırmadan çıkan ilkeler

Google'ın içerik rehberi, kaynağı yeniden yazmak yerine ek değer üretmeyi, uzmanlık ve açık kaynak kullanımını, okuyucunun işini tamamlayabilmesini ve bağımsız değerlendirmeyi öne çıkarıyor. Belirli bir kelime sayısı kalite veya sıralama garantisi değil. Bu yüzden üretim talimatındaki yaklaşık 300 kelime hedefini kaldırdım; tek soruya yeterli, somut cevap ve özgün katkı istiyorum. [Google Search Central](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)

Kullanıcı ihtiyacını çözüm formatından önce belirlemek gerekir. “İnteraktif banner istiyoruz” ihtiyaç değildir; “bu eğitimin işimde hangi durumda yararlı olacağını anlayamıyorum” test edilebilir bir ihtiyaç hipotezidir. Bu örnek CROV kullanıcı araştırması sonucu değil, doğrulanacak önerimizdir. [GOV.UK kullanıcı ihtiyaçları](https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs)

Başarı ölçümünü kullanıcı araştırmasıyla birlikte kurmak, aynı görevleri karşılaştırmalı denemek daha savunulabilir sonuç verir. Aşağıdaki pilot tasarımı bu ilkenin bizim MVP’ye uyarlamasıdır; sonuç garantisi değildir. [Başarıyı ölçmek](https://www.gov.uk/service-manual/measuring-success/measuring-the-success-of-your-service), [kullanılabilirlik karşılaştırması](https://www.gov.uk/service-manual/measuring-success/usability-benchmarking-a-website-or-whole-service)

Üretken modelin akıcı cevap vermesi doğruluk kanıtı değildir. Üretim ve değerlendirmeyi ayırmamızın nedenlerinden biri bu. [NIST üretken AI profili](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

## Önerdiğim sade akış

1. **Araştır:** kendi kursunun doğrulanmış bilgilerini ve ilgili rakip/meslek kaynaklarını getir. Her kaynakta tarih, pasaj, tür ve sınırlama görünsün.
2. **Seç:** kaydedilen fırsatlardan birini seç. “Hangi kişi, hangi durumda, hangi kararı vermekte zorlanıyor?” sorusuna cevap yaz.
3. **Brief oluştur:** kaynak gözlemi, bizim yorumumuz ve test edeceğimiz mesajı ayrı tut. Bir ana hedef ve CTA seç. Kaynak ve varsayım çelişkilerini çözmeden içerik çeşitlendirme.
4. **En küçük paketi seç:** bir ana içerik; gerekirse onu destekleyen bir format. Blog/FAQ, senaryo veya banner sırf mevcut diye üretilmesin.
5. **Üret ve incele:** kendi kurs iddiaları, kaynak pasajları, marka sürümü ve kullanılan prompt sürümü paketle birlikte görülsün.
6. **İnsan değerlendirsin:** aşağıdaki ölçütler için somut örnek ve karşılaştırma kaydedilsin. Gerekirse yeniden çalışılsın.
7. **Küçük pilot:** hedef kitleye gerçek görev ver, anlamayı/yararı ölç. Trafik ve uygun deney tasarımı varsa sonrasında dönüşüm etkisini araştır.
8. **Öğren:** yalnız testte işe yarayan mesaj/formatı referans kütüphanesine al. Şimdilik bu sonucun otomatik geri beslemesi yok.

Örnek yaratıcı yön: “Bir verzuim görüşmesinde bir sonraki adımı seçerken hangi bilgi eksik?” Bir senaryo ve seçeneklerin farklı gerekçeleri gerçek yarar üretebilir. Bu, onaylı ders içeriği ve uzmanın incelemesiyle netleştirilmeli; hukuki vaka çözümü, kursun kapsamadığı vaat veya kişinin mesleki yeterliliği hakkında hüküm verilmemeli. B2 gibi giriş koşulları kullanıcı özellikle uygunluk koşullarını araştırıyorsa yerinde olabilir; her kampanyanın açılış fikri olması gerekmez.

## Altı kalite ölçütü

| Ölçüt | Somut kanıt | Kabul etmeyeceğimiz örnek |
|---|---|---|
| Doğruluk | Kritik iddialar tek tek kurs kaydı/uygun kaynağa karşı kontrol edilmiş; incelenen pasaj belirtilmiş | Kaynak listesini görmekle tüm metni doğru saymak |
| Fayda | Okuyucunun hangi sorusunu cevapladığı ve hangi sonraki adımı mümkün kıldığı açık | Genel tanıtım, “kendini geliştir” gibi boş vaat |
| Özgün katkı | Referansta olmayan açıklama, araç veya anlamlı afweging; hangi katkı olduğu gösterilmiş | Rakibin metnini farklı sözcüklerle yeniden yazmak |
| Marka | Mevcut yazılı kurallara, örnek içeriklere, renk/font kullanımına karşı inceleme | Yalnız logoyu koyup tam marka uyumu demek |
| Kullanılabilirlik | Gerçek dosya, mobil/masaüstü, tüm seçenekler, CTA ve okunurluk incelenmiş | ZIP üretildi diye tasarım onayı vermek |
| Ölçüm | Karşılaştırılan içerik, hedef görev, birincil ölçüt, dönem ve değerlendirme kararı yazılı | AI’nın kendi çıktısına 9/10 vermesi |

Sistemde her ölçüt için kabul/yeniden çalışılacak kararı ve en az 20 karakterlik somut gerekçe kaydedilir. Metin uzunluğu yalnız boş değerlendirmeyi önleyen biçim kontrolüdür; gerekçenin doğru olduğunu otomatik ispatlamaz. Pilot kararı tüm ölçütlerin insan tarafından kabulünü, güncel gerçek çıktıyı ve yazılı marka kurallarını gerektirir. Bu karar **yayın onayı değildir**.

## Bir haftada savunulabilir değer testi

Önerilen pilot protokolü; henüz yürütülmedi:

- Tek CROV briefini sabitle. Aynı hedef, aynı kaynak paketi ve aynı teslimi hem mevcut yöntemle hem tool ile hazırlat.
- Mevcut bir içerik yalnız farklı brief için yazılmışsa doğrudan adil karşılaştırma sayma; farkları kaydet.
- Tool ile üç bağımsız taslak denemesi kaydet. Başarısız denemeleri ve tekrar maliyetlerini dahil et. Yalnız en güzel örneği seçerek genel kalite iddiası kurma.
- Bir kurs uzmanı ve bir içerik/marka editörü mümkünse üretim yöntemini bilmeden, rastgele sırayla değerlendirir. Aynı kişi üretip değerlendirirse bu sınırlamayı belirt.
- Her ölçütte kabul/yeniden çalışma kararı, hata örneği ve gerekli düzeltme kaydedilir. Kritik yanlış iddia varsa taslak elenir.
- 3–5 ilgili hedef kitle katılımcısıyla keşif testi yapılabilir: “Bu içerikten ne anladın?”, “Bir sonraki adımın ne olurdu?”, “Hangi bilgi eksik?”. Bu küçük sayı kullanım sorunlarını bulmak içindir; pazar oranı veya dönüşüm artışı iddiası için değildir.
- İnsanların **aktif çalışma ve düzeltme dakikalarını**, bekleme süresini, AI/API giderini ve tekrarları ayrı kaydet. Yeni form referans ve nabewerking dakikalarını manuel kaydeder; tam toplam maliyet hesabı henüz otomatik değil.

Önceden belirlenecek ana değer ölçütü: **aynı kalite kriterlerini karşılayan teslim başına aktif insan zamanı ve toplam maliyet.** Kaliteyi düşürerek kazanılan hız başarı sayılmasın. Bu pilot istatistiksel üstünlük kanıtı değil, ilk uygulanabilirlik karşılaştırmasıdır.

Maliyet hesabı: insan zamanı × kurumun belirlediği saat maliyeti + AI/API tüketimi + sağlayıcı abonelik payı + yeniden çalışma. Tasarruf varsa ancak iki tarafın aynı kapsamlı toplamı üzerinden hesapla. GA4 tıklaması kayıt değildir; kaydı ayrı ölç. Kontrolsüz önce/sonra farkını tool’un neden olduğu artış diye sunma.

## Bu değişiklikte uygulananlar

- Paket ve Studio içinde “Bewijs & kwaliteitsbeoordeling”: veri varlığı ile kalite hükmü ayrılıyor.
- Kaynak pasajları, sürümler, format hipotezleri ve çözülmemiş boşluklar tek dosyada; JSON olarak indirilebilir.
- ZIP içine `bewijs-en-beperkingen.json` eklendi. Bu ZIP dosyası insan review geçmişini içermez; güncel review geçmişi ayrı kanıt indirmesindedir.
- Yetkili değerlendiricinin kriter/gerekçe, karşılaştırma, pilot planı ve isteğe bağlı süre kaydı veritabanına ekleniyor. Kayıtlar mevcut kayıt üzerine yazılmıyor; yeni kayıt ekleniyor.
- Bilinmeyen süreler null kalıyor; sıfır maliyet veya hayali tasarruf gösterilmiyor.
- Öneri prompt’u önce en küçük yararlı paketi istiyor. Üretim prompt’u okuyucunun işini tamamlayan somut katkı istiyor; hayali örneği gerçek vaka gibi sunmaması isteniyor.
- Bu kontroller ek AI çağrısı gerektirmiyor. Eski çıktılar yeniden yazılmıyor, uzman yerine sistem adına değerlendirme girilmiyor.

## Sonraki işler: etkiye göre sıra

| Sıra | İş | Neyi güçlendirir? |
|---|---|---|
| P0 | CS yazılı marka kurallarını ve 2–3 onaylı iyi içerik örneğini portalda tamamla | Somut editoryal kalite referansı |
| P0 | Bir gerçek uzman değerlendirmesini ve yukarıdaki küçük karşılaştırmayı yap | Sunumda kanıtlanabilir ilk değer |
| P0 | Tüm fiyat, koşul, akreditasyon ve sonuç iddialarını tek tek kontrol et | Yanlış kurs vaadi riskini azaltma |
| P1 | İddia → kurs alanı/kaynak pasajı → içerik bölümü ilişkisi; desteklenmeyen iddiada durdurma | Cümle düzeyine yaklaşan provenance; sadece kaynak kimliği kontrolü yetmez |
| P1 | Studio’da gerçek HTML5 önizleme ve paket kopyasında sürümlü editör | Editörün ZIP açma/yeniden üretme yükünü azaltma |
| P1 | GSC + GA4 ve event/UTM planı | Gerçek sorgu ve sonuç bilgisi; kurulum/consent ayrı iş |
| P1 | Seçilmiş format için ayrı şema, tekrarlanan bağlamı yeniden kullanma | Kullanılmayan çıktı ve yeniden üretim maliyetini azaltma |
| P2 | Başarılı ve başarısız uzman değerlendirmeleriyle regresyon içerik seti | Model/prompt değişince kalite kaybını fark etme |
| P2 | İzinli rakip/keyword API ve veri güncellik politikası | Daha istikrarlı araştırma, daha az tekrarlanan web/AI işi |
| P2 | Ölçülen sonuçtan yeni briefing hipotezine geri besleme | Üretimden öğrenmeye geçiş |

Bağlantıların veri, erişim ve maliyet ayrıntıları: [API yol haritası](data-api-roadmap-tr.md).

## Sunumda zor sorulara dürüst cevaplar

**“Bu sonuca nereden ulaştın?”** Kaynak pasajını ve tarihi aç, kursun onaylı bilgisini göster, sonra hangi kısmın bizim yaratıcı hipotezimiz olduğunu belirt. Kaynağın içinde geçmeyen yorumu kaynağın söylediği gibi sunma.

**“Kaliteli olduğunu nereden biliyorsun?”** Şu an önce süreç ve teknik kontrolü gösteririz. Uzman/okuyucu değerlendirmesi yapıldıktan sonra değerlendiren kişi, somut gerekçe, karşılaştırma ve düzeltmeleri gösteririz. Yapılmadıysa “henüz ölçmedik” deriz.

**“Neden ChatGPT kullanmayalım?”** Bu ürünün savunulabilir farkı tek metnin akıcılığı değil; kaynak, marka/kurs sürümü, briefing kararı, tekrar kullanılabilir teslim ve ekip değerlendirmesini aynı iş kaydında tutması. Bunun zaman kazandırdığı ayrıca ölçülecek.

**“Daha çok kayıt getirir mi?”** Şimdilik bilmiyoruz. İlk pilot kullanılabilir teslim ve editör zamanı içindir. Kayıt etkisi için uygun takip ve karşılaştırmalı kampanya deneyi gerekir.

## Bu değişikliğin doğrulanması

40 dosyada 476 test geçti; typecheck, lint ve build başarılı. Tarayıcı kontrolü, mevcut gerçek paketlerde briefing/kaynak görünümünü ve değerlendirme formunu kapsadı. Formun POST isteği UI testi sırasında karşılandı; gerçek kampanyalara hayali insan değerlendirmesi yazılmadı. Entegrasyon testinde test veritabanına kaydetme/okuma, label yetkileri ve tüm ölçütleri kabul edilmiş olsa bile mock çıktının pilot için reddedilmesi kontrol edildi. Bu testler üretilen metnin editoryal kalitesini ölçmez.
