# AI motorlarında doğrudan ölçüm — teknik araştırma

11 Eylül 2026. Bu belge dokümantasyon araştırmasıdır; ücretli test isteği, hesap açma veya yeni entegrasyon yapılmadı. Sağlayıcı kabiliyetleri kendi belgelerinden doğrulandı; cevap kalitesi, NL kapsaması ve oturum koşulları canlı pilotta doğrulanmalı.

## Karar önerisi

İlk pilot: **ChatGPT Search + Gemini için DataForSEO LLM Scraper**. Google AI Mode gerektiğinde ayrı SerpApi adapter'ı eklenebilir. Perplexity/Copilot da ilk pakette isteniyorsa Bright Data karşılaştırmalı adaydır. Tek sağlayıcıyla başlamak operasyonu basitleştirir; bu, ölçülmüş kalite/fiyat üstünlüğü iddiası değildir.

Önceki rapor yalnız LLM Responses ürününü aday olarak anıyordu. Araştırmada ayrıca ayrı **LLM Scraper** ürünleri bulundu. Motor deneyimini incelemek için kritik fark budur. ChatGPT Search sonuçları da ChatGPT'nin bütün sohbet modlarının veya kullanıcının kişisel hesabının eşdeğeri değildir. [ChatGPT Scraper açıklaması](https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/overview/).

## Üç teknik yol

| Yol | Ne ölçer? | Bizim kullanımımız |
|---|---|---|
| Resmi model API'sine prompt gönderme | İlgili API modelinin belirtilen araç/ayarlarla cevabı | Ayrı api_model deneyi; consumer motor kartına dönüştürülmez |
| Yönetilen motor sonuç toplama API'si | Sağlayıcının tanımladığı ChatGPT Search, Gemini veya diğer ürün yüzeyinden topladığı cevap | İstenen otomatik motor ölçümüne en yakın aday; ürün yüzeyi ve toplama bağlamı kayıt altına alınır |
| Kendi tarayıcı otomasyonumuz | Kontrol edilebildiği ve izin verildiği ölçüde belirli bir tarayıcı oturumu | Daha fazla bakım, oturum ve erişim kısıtı; bir haftalık MVP için ilk tercih değil |

Tarayıcı yolu teknik olarak yeni oturum açma, aynı soruyu yazma, cevabın tamamlanmasını bekleme ve metin/alıntı/kanıt kaydetme adımlarından oluşur. Ancak erişim kontrolü, CAPTCHA veya engelleme aşma üzerine bir çözüm kurulmamalı. Third-party ürünün mevcut olması hedef ürünün şartlarına otomatik uygunluk kanıtı değildir; sözleşme ve izin kapsamı ayrıca değerlendirilir. Bu araştırma kendi scraper'ımızı çalıştırma izni yerine geçmez.

## Doğrulanan adaylar

### DataForSEO: ChatGPT Search

POST uç noktası:

    https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced

HTTP Basic kimlik doğrulaması sağlayıcının API hesabıyla yapılır; ChatGPT hesabının parolası gönderilmez. JSON gövdesi tek görev içeren array'dir. keyword, location_name veya location_code, language_code veya language_name kullanılır. İsteğe bağlı force_web_search vardır; kaynak alıntılanacağını garanti etmez. Live çağrı 120 saniyeye kadar sürebilir; worker içinde çalıştırılmalı.

Yanıtta görev maliyeti/durumu, model, tarih, markdown, search_results, sources ve desteklendiğinde fan_out_queries/brand_entities alanları bulunur. Aramada getirilen bütün kaynaklar ile cevapta kullanılan kaynaklar ayrıdır. rank_absolute alanı sonuç öğesinin sırasıdır; markanın öneri sırası değildir. [Endpoint belgesi](https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_scraper-live-advanced/).

Aşağıdaki gövde çalıştırılmamış bir örnektir. Hollanda/nl değerleri kullanılmadan önce ilgili locations/languages listesinden hesap erişimiyle doğrulanmalı:

```json
[
  {
    "keyword": "Welke aanbieders bieden een CROV-opleiding aan in Nederland?",
    "location_name": "Netherlands",
    "language_code": "nl",
    "force_web_search": true,
    "tag": "crov-baseline-q01-repeat01"
  }
]
```

force_web_search=true ayrı bir deney koşuludur; varsayılan sohbet gözlemiyle aynı grupta raporlanmaz.

### DataForSEO: Gemini

Ayrı endpoint:

    https://api.dataforseo.com/v3/ai_optimization/gemini/llm_scraper/live/advanced

Soru, konum ve dil parametreleri vardır. Metin/tablo gibi sonuç öğelerinde markdown/original_text ve kaynak alanları bulunur. ChatGPT'ye özel force_web_search parametresini Gemini'ye kopyalamayız. Advanced sonuçlara ek olarak doküman HTML alma yüzeyi de tanımlar. [Gemini genel açıklaması](https://docs.dataforseo.com/v3/ai_optimization/gemini/llm_scraper/overview/), [Gemini endpoint](https://docs.dataforseo.com/v3/ai_optimization/gemini/llm_scraper/live/advanced/).

### Google AI Mode: SerpApi

GET https://serpapi.com/search.json üzerinde engine=google_ai_mode, q, api_key ve uygun konum/dil parametreleri kullanılır. text_blocks, references ve reconstructed_markdown dönebilir. Bu, Gemini uygulaması değildir; Google AI Overview da ayrı yüzeydir.

Tekrar deneyinde cache kritik: belgede cache süresi bir saat; no_cache=true taze sonuç ister. Aynı cached cevabı üç kez almak üç bağımsız gözlem değildir. async ve no_cache birlikte kullanılmamalı. Senkron sağlayıcı çağrısı yine kendi worker'ımızda yürütülebilir. [SerpApi AI Mode dokümanı](https://serpapi.com/google-ai-mode-api).

### Daha geniş motor listesi: Bright Data

Ürün sayfası ChatGPT, Gemini, Perplexity ve Copilot gibi motorlar için toplama kabiliyeti listeliyor. Aynı API anahtarı altında motorlara göre ayrı dataset/şema kullanılır; tek bir yanıtı bütün motorlara kopyalamayız. Claude consumer desteğini bu incelemede doğrulamadım. [LLM Scraper ürün sayfası](https://brightdata.com/products/web-scraper/llm).

ChatGPT için doğrulanan çağrı: POST https://api.brightdata.com/datasets/v3/scrape, dataset_id=gd_m7aof0k82r803d5bjm; Bearer API anahtarı; input array'inde url ve prompt. Örnek cevap şeması answer_text, answer_text_markdown, model, citations, search_sources, country ve prompt_sent_at alanlarını içeriyor. include_errors ile başarısız girdiler izlenebilir. require_sources=true kullanıldığında kaynak bulunmaması kayıt yerine hata üretebilir; bu ayar ölçümde kaynak yokluğunu sansürleyebileceği için varsayılan tercih edilmemeli. [ChatGPT API belgesi](https://docs.brightdata.com/api-reference/scrapers/ai-search-apis/chatgpt-search-by-prompt).

Bright Data'nın ilgili ürün sayfasında 5.000 kayıt/ay ücretsiz katman ve $1,50/1.000 kayıt kullanım fiyatı ilan ediliyor (inceleme tarihi itibarıyla). Bu, bizim hesapta bütün motorlar için doğrulanmış fiyat teklifi değildir; kayıt tanımı, kapsam, limit ve sözleşme kontrol edilir. DataForSEO fiyat sayfasındaki sayısal tablo bu oturumda okunamadı; fiyat uydurulmadı. [DataForSEO fiyat sayfası](https://dataforseo.com/pricing/ai-optimization/llm-scraper).

## Platformumuza önerilen uygulama

Aşağıdakiler tasarımdır, çalışan endpoint adları değildir.

1. Aktif label/kurs üzerinden soruları öner. Kullanıcı ölçülecek soruları ve motorları seçer.
2. Branded, unbranded ve rakip adı içeren soruları ayır. Markasız ölçüm sorusuna kendi marka kurallarını, kurs URL'sini veya tanıtım briefini gizlice ekleme. Mevcut pazarlama üretim prompt'u ölçüm prompt'u olarak kullanılmaz.
3. Benchmark'ta tam soru, ülke/dil, yüzey, arama modu, oturum bilgisi ve tekrar sayısını dondur. Bilinmeyen oturum/model bilgisi bilinmiyor kalır.
4. Mevcut PostgreSQL job kuyruğundan her soru × motor × tekrar için bir ölçüm hücresi çalıştır. Önerilen iş türü visibility.measure; mevcut geo.research işinin yeniden adlandırılması değildir.
5. Sağlayıcıya sunucudan çağrı yap; anahtar browser'a gitmez. Görev kimliği, veri ve yanıt hash'i saklanır. Zaman aşımında yeni ücretli görev açmadan önce mevcut provider görevini sorgula; idempotency/polling ve retry politikası adapter'a göre doğrulanır.
6. Ham provider JSON + cevap metni + alıntılar + varsa HTML/kanıt saklanır. Tam HTML uygulamada doğrudan çalıştırılmaz. Büyük kanıt dosyaları mevcut yetkili depolamaya, referansları DB'ye gider.
7. Marka/alias/domain eşleme ve oranlar kodla hesaplanır. Kaynak seçimi ile arama sonucu listesi ayrılır. Sağlayıcının brand_entities alanı yardımcı veri olur, tek gerçeklik kaynağı değil.
8. İlgili motor cevabından GEO analizi başlatılır. Görünmeme tek başına içerik açığı kabul edilmez; alıntılanan sayfalar ve kendi kurs sayfası incelenir. Sonra mevcut briefing/marka/insan onayı akışıyla sayfa, blog veya sosyal öneri üretilir.

Önerilen normalize kayıt alanları:

```typescript
interface EngineObservation {
  benchmarkId: string;
  promptId: string;
  repetition: number;
  engine: "chatgpt_search" | "gemini" | "google_ai_mode" | "perplexity";
  captureMethod: "third_party_surface" | "official_api" | "manual_import";
  provider: string;
  providerTaskId: string;
  countryRequested: string;
  languageRequested: string;
  sessionObserved: "fresh" | "personalized" | "unknown";
  modelObserved: string | null;
  retrievedAt: string;
  cacheStatus: "fresh" | "cached" | "unknown";
  status: "success" | "blocked" | "failed";
  answerText: string | null;
  citations: Array<{ url: string; quote: string | null }>;
  rawEvidenceRef: string | null;
  cost: { amount: number; currency: string } | null;
}
```

Bu öneri mevcut contracts ile henüz birebir aynı değil. Şimdiki VisibilityObservation manual_import ile sınırlı; motor enum'u Google AI Mode'u kapsamıyor. Contracts, migration, adapter registry, budget/job handler ve ekran birlikte genişletilmeli. Eski manuel kayıtlar kendi yöntemiyle korunmalı. GEO raporları da consumer ölçümüymüş gibi dönüştürülmemeli.

Ekran: her soru için motor kartları → cevap aç → kaynaklar → bizim marka/rakipler → inceleme aksiyonu. Hata ve ölçülmedi ayrı; marka hiç geçmedi demek için başarılı ve tam bir cevap gerekir. Öneri sırası yalnız gerçekten sıralı öneri listesi varsa ve anlamı doğrulanmışsa gösterilir.

## Pilot ve maliyet kontrolü

Önerilen ilk deneme: 5 soru × 2 motor × 2 bağımsız tekrar = 20 ölçüm. İlk amaç entegrasyon ve kanıt kalitesidir; 20 gözlemden pazar genellemesi çıkarılmaz.

- Hollanda/dil kapsamını sağlayıcı listelerinde doğrula.
- Aynı sorulardan birkaçını benzer zamanda manuel arayüzle kontrol et; birebir aynı metni beklemek yerine yüzey, kaynak ve bağlam uyuşmazlıklarını kaydet.
- Ham cevap/alıntı/kanıt gerçekten geliyor mu? Yeniden oynatılabilen bir URL mi, yoksa yalnız yeni sorgu başlatan check_url mi? Canlı testte ayır.
- Kaynaksız cevap, ülke desteklenmemesi ve timeout'u özellikle dene.
- Bir motor hata verince diğer hücreleri kaybetme; eksik veriyi sıfır sayma.
- Gerçek ücret/hücre ve gecikme ölç. 5 soru × 3 motor × 2 tekrar × 4 dönem = 120 ölçüm/ay; aylık bedel sağlayıcı hücre fiyatları, minimum paket ve analiz maliyetinden hesaplanır.
- Marka eşleme, domain ayırma, oran ve CSV/JSON export için LLM kullanma. Ek AI yalnız yorumlama/yazım aşamasında çalışsın.

Sonuç: yapılabilir. İlk pratik ihtiyaç, seçilen toplama sağlayıcısının API hesabı ve dar bir pilot bütçesidir. Mevcut model anahtarı ayrı motor toplama API'lerine otomatik erişim sağlamaz. Bu araştırmada hesapla doğrulanmış pilot çalıştırılmadı; sonraki adım bunu küçük ölçekte test etmektir.
