import { AlertTriangle, BookOpen, ShieldCheck } from 'lucide-react';

interface RuleItem {
  number: string;
  title: string;
  content: React.ReactNode;
}

const GENERAL_RULES: RuleItem[] = [
  {
    number: '01',
    title: 'Uygulama ve Daire Şifresi',
    content: (
      <>
        Tüm kort rezervasyonları ve iptal işlemleri, site yönetimi tarafından daireye tahsis edilen şifre ile bu uygulama üzerinden çevrim içi yapılır.
      </>
    ),
  },
  {
    number: '02',
    title: 'Günlük ve Aktif Sınır',
    content: (
      <>
        Mevcut rezervasyon saati tamamlanmadan yeni bir rezervasyon açılamaz ve aynı gün içinde birden fazla rezervasyon yapılamaz.
      </>
    ),
  },
  {
    number: '03',
    title: 'Yoğun Saat (18:00 - 21:00)',
    content: (
      <>
        Saat <strong className="font-semibold tabular-nums text-slate-900">18:00 - 21:00</strong> aralığında üst üste{' '}
        <strong className="font-semibold tabular-nums text-slate-900">2 gün</strong> rezervasyon yapılamaz. Bu saatler boş kalırsa aynı gün saat{' '}
        <strong className="font-semibold tabular-nums text-slate-900">15:00</strong> sonrasında yeniden rezerve edilebilir.
      </>
    ),
  },
  {
    number: '04',
    title: 'Bireysel Antrenman',
    content: (
      <>
        <span className="tabular-nums">18:00 - 21:00</span> yoğun saat aralığı dışında, antrenman amaçlı tek başına rezervasyon yapılabilir.
      </>
    ),
  },
  {
    number: '05',
    title: 'Rezervasyonsuz Kullanım',
    content: (
      <>
        Kort müsait olduğunda rezervasyon yapılmadan da kullanılabilir; ancak bu sırada başka bir daire tarafından rezerve edilirse kullanım hakkı rezervasyon sahibine geçer.
      </>
    ),
  },
  {
    number: '06',
    title: 'Ücretsiz İptal (4 Saat)',
    content: (
      <>
        Rezervasyon başlangıcından en geç{' '}
        <strong className="font-semibold tabular-nums text-slate-900">4 saat</strong> öncesine kadar cezasız iptal edilebilir.
      </>
    ),
  },
];

export function RulesView() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex items-start gap-4 sm:gap-5">
        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
          <BookOpen className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-emerald-800">Soyak Siesta Site Düzenlemesi</p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
            Tenis Kortu Kullanım ve Rezervasyon Kuralları
          </h1>
          <p className="text-base sm:text-[17px] text-slate-700 leading-relaxed">
            Korttan tüm daire sakinlerinin adil ve düzenli yararlanabilmesi için geçerli olan esaslar ve yaptırımlar aşağıdadır.
          </p>
        </div>
      </div>

      {/* Cezai Yaptırımlar — Kırmızı Vurgulu Tek Bölüm */}
      <section className="bg-red-50 border border-red-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-red-200 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-red-700 text-white flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-red-900">
              Cezai Yaptırımlar ve Kısıtlamalar
            </h2>
            <p className="text-sm sm:text-base text-red-800">
              Aşağıdaki iki ihlalde sistem ve site yönetimi tarafından yaptırım uygulanır:
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-red-200 bg-white/60">
          <div className="p-6 space-y-2">
            <h3 className="font-display text-base sm:text-lg font-bold text-red-800">
              1. Geç İptal Cezası (4 Saatten Az Kala)
            </h3>
            <p className="text-base sm:text-[17px] text-red-900 leading-relaxed">
              Başlangıca <strong className="font-bold tabular-nums">4 saatten kısa süre kala</strong> yapılan iptaller geç iptal sayılır.{' '}
              <strong className="font-bold tabular-nums">15 gün içinde ilk geç iptal için uyarı</strong> verilir; tekrarı halinde{' '}
              <strong className="font-bold underline decoration-red-400">
                1 hafta boyunca rezervasyon hakkı iptal edilir
              </strong>
              .
            </p>
          </div>

          <div className="p-6 space-y-2">
            <h3 className="font-display text-base sm:text-lg font-bold text-red-800">
              2. Daire Sakini Zorunluluğu ve Cezası
            </h3>
            <p className="text-base sm:text-[17px] text-red-900 leading-relaxed">
              Kortu kullanan kişilerden en az birinin ilgili daire sakini olması zorunludur. Daire sakini olmadan kullanım tespit edilirse{' '}
              <strong className="font-bold">ilk seferde uyarı</strong> yapılır; tekrarında{' '}
              <strong className="font-bold underline decoration-red-400">
                1 ay rezervasyon hakkı iptali ve yönetim inisiyatifiyle ücretli ceza
              </strong>{' '}
              uygulanır.
            </p>
          </div>
        </div>
      </section>

      {/* Rezervasyon ve Kort Kullanım Esasları — Tekrarsız Tek Liste */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900">
            Rezervasyon ve Kort Kullanım Esasları
          </h2>
        </div>

        <ol className="divide-y divide-slate-200">
          {GENERAL_RULES.map((rule) => (
            <li
              key={rule.number}
              className="grid grid-cols-1 sm:grid-cols-12 px-6 py-5 gap-2 sm:gap-5 items-baseline"
            >
              <div className="sm:col-span-4 flex items-baseline gap-2.5">
                <span className="font-mono text-sm font-semibold tabular-nums text-emerald-800">
                  {rule.number}.
                </span>
                <span className="font-display text-base sm:text-[17px] font-bold text-slate-900">
                  {rule.title}
                </span>
              </div>
              <p className="sm:col-span-8 text-base sm:text-[17px] text-slate-700 leading-relaxed">
                {rule.content}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
