import { AlertTriangle, BookOpen, Clock, ShieldCheck } from 'lucide-react';

export function RulesView() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex items-start gap-4 sm:gap-5">
        <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
          <BookOpen className="w-7 h-7" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-emerald-800">Soyak Siesta Site Düzenlemesi</p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
            Tenis Kortu Kullanım ve Rezervasyon Kuralları
          </h1>
          <p className="text-base sm:text-lg text-slate-700 leading-relaxed">
            Korttan tüm daire sakinlerinin adil, düzenli ve kesintisiz biçimde yararlanabilmesi için aşağıdaki rezervasyon, iptal ve kullanım esasları uygulama üzerinden otomatik olarak denetlenir.
          </p>
        </div>
      </div>

      {/* Prominent Red Penalty Highlights */}
      <section className="bg-red-50 border border-red-200 rounded-2xl p-6 sm:p-7 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-red-700 text-white flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-red-900">
              Cezai Yaptırımlar ve Kısıtlamalar
            </h2>
            <p className="text-sm sm:text-base text-red-800">
              Aşağıdaki ihlallerde yaptırımlar sistem ve site yönetimi tarafından uygulanır:
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-red-200 rounded-xl p-5 space-y-2">
            <h3 className="font-display text-base sm:text-lg font-bold text-red-800">
              Geç İptal Cezası (4 Saatten Az Kala)
            </h3>
            <p className="text-base text-red-900 leading-relaxed">
              Başlangıca <strong className="font-bold">4 saatten kısa süre kala</strong> yapılan iptaller geç iptal sayılır.{' '}
              <strong className="font-bold">15 gün içinde ilk geç iptal için uyarı</strong> verilir; tekrarı halinde{' '}
              <strong className="font-bold underline decoration-red-400">
                1 hafta boyunca rezervasyon hakkı iptal edilir
              </strong>
              .
            </p>
          </div>

          <div className="bg-white border border-red-200 rounded-xl p-5 space-y-2">
            <h3 className="font-display text-base sm:text-lg font-bold text-red-800">
              Daire Sakini Olmadan Kullanım Cezası
            </h3>
            <p className="text-base text-red-900 leading-relaxed">
              Kortu kullanan kişiler arasında ilgili daire sakininin bulunmadığı tespit edilirse{' '}
              <strong className="font-bold">ilk seferde uyarı</strong> uygulanır; tekrarında{' '}
              <strong className="font-bold underline decoration-red-400">
                1 ay rezervasyon hakkı iptali ve yönetim inisiyatifiyle ücretli ceza
              </strong>{' '}
              uygulanır.
            </p>
          </div>
        </div>
      </section>

      {/* Quick Rule Parameters Grid */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2.5">
          <Clock className="w-5 h-5 text-slate-700" aria-hidden="true" />
          <h2 className="font-display text-lg font-bold text-slate-900">
            Özet Kural ve Yaptırım Tablosu
          </h2>
        </div>
        <div className="divide-y divide-slate-200 text-base sm:text-[17px] leading-relaxed">
          <div className="grid grid-cols-1 sm:grid-cols-12 px-6 py-4 gap-2 sm:gap-4">
            <span className="sm:col-span-4 font-bold text-slate-900">Ücretsiz İptal Süresi</span>
            <span className="sm:col-span-8 text-slate-700">
              Rezervasyon başlangıcından en geç <strong className="font-mono text-slate-900">4 saat</strong> öncesine kadar cezasız iptal edilebilir.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 px-6 py-4 gap-2 sm:gap-4 bg-red-50/70">
            <span className="sm:col-span-4 font-bold text-red-800">Geç İptal Yaptırımı</span>
            <span className="sm:col-span-8 text-red-800 font-medium">
              <strong className="font-mono font-bold text-red-900">15 gün</strong> içinde ilk geç iptal için{' '}
              <strong className="font-bold text-red-900">uyarı</strong>; tekrarı halinde{' '}
              <strong className="font-bold text-red-900">1 hafta rezervasyon hakkı iptali</strong>.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 px-6 py-4 gap-2 sm:gap-4 bg-red-50/70">
            <span className="sm:col-span-4 font-bold text-red-800">Daire Sakini Zorunluluğu</span>
            <span className="sm:col-span-8 text-red-800 font-medium">
              İlk tespitte <strong className="font-bold text-red-900">uyarı</strong>; tekrarı durumunda{' '}
              <strong className="font-bold text-red-900">1 ay rezervasyon hakkı iptali</strong> ve{' '}
              <strong className="font-bold text-red-900">yönetim inisiyatifinde ücretli ceza</strong>.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 px-6 py-4 gap-2 sm:gap-4">
            <span className="sm:col-span-4 font-bold text-slate-900">Günlük ve Aktif Sınır</span>
            <span className="sm:col-span-8 text-slate-700">
              Mevcut rezervasyon saati tamamlanmadan yeni kayıt açılamaz ve aynı gün içinde birden fazla rezervasyon yapılamaz.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 px-6 py-4 gap-2 sm:gap-4">
            <span className="sm:col-span-4 font-bold text-slate-900">Yoğun Saat (18:00 - 21:00)</span>
            <span className="sm:col-span-8 text-slate-700">
              Üst üste <strong className="font-mono text-slate-900">2 gün</strong> rezervasyon yapılamaz. Boş ise aynı gün saat <strong className="font-mono text-slate-900">15:00</strong> sonrasında yeniden rezerve edilebilir.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 px-6 py-4 gap-2 sm:gap-4">
            <span className="sm:col-span-4 font-bold text-slate-900">Bireysel Antrenman</span>
            <span className="sm:col-span-8 text-slate-700">
              18:00 - 21:00 yoğun saat aralığı dışında tek başına antrenman amaçlı rezervasyon yapılabilir.
            </span>
          </div>
        </div>
      </div>

      {/* Full Regulation Clauses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
        <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 space-y-4">
          <div className="flex items-center gap-3 pb-3.5 border-b border-slate-200">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            </div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900">
              01. Rezervasyon ve İptal Koşulları
            </h2>
          </div>
          <ol className="space-y-4 text-base sm:text-[17px] text-slate-700 leading-relaxed list-decimal pl-5">
            <li>
              Tüm kort rezervasyonları ve iptal işlemleri çevrim içi (online) uygulama üzerinden, daire numaralarına tahsis edilen şifreler kullanılarak yapılacaktır.
            </li>
            <li>
              Rezervasyonların en geç 4 saat öncesine kadar iptal edilmesi gerekmektedir; bu süre zarfındaki iptallerde herhangi bir cezai yaptırım uygulanmayacaktır.
            </li>
            <li className="text-red-800 font-semibold bg-red-50 border border-red-200 rounded-xl p-3.5 list-inside">
              4 saatten kısa süre kala yapılan iptaller &ldquo;geç iptal&rdquo; olarak değerlendirilecektir. 15 günlük süreç içerisinde ilk geç iptal için uyarı verilecek, tekrarı halinde ise 1 haftalık rezervasyon hakkı iptal edilecektir.
            </li>
          </ol>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 space-y-4">
          <div className="flex items-center gap-3 pb-3.5 border-b border-slate-200">
            <div className="w-9 h-9 rounded-xl bg-emerald-700 text-white flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5" aria-hidden="true" />
            </div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900">
              02. Kort Kullanım Esasları
            </h2>
          </div>
          <ol className="space-y-4 text-base sm:text-[17px] text-slate-700 leading-relaxed list-decimal pl-5">
            <li className="text-red-800 font-semibold bg-red-50 border border-red-200 rounded-xl p-3.5 list-inside">
              Kortu kullanan kişilerden en az birinin ilgili daire sakini olması zorunludur. İlk tespitte uyarı yapılır; tekrarı durumunda 1 aylık rezervasyon hakkı iptal edilir ve ücretli bir ceza uygulaması yönetimin inisiyatifindedir.
            </li>
            <li>
              Daire sakinleri, mevcut rezervasyon saati tamamlanmadan yeni bir rezervasyon oluşturamazlar. Aynı gün içinde birden fazla rezervasyon yapılamaz.
            </li>
            <li>
              Kortun müsait olması durumunda rezervasyon yapılmadan da kort kullanılabilir; fakat bu sırada kortun rezerve edilmesi halinde kort kullanım hakkı rezerve edene aittir.
            </li>
            <li>
              Saat 18:00 - 21:00 aralığında üst üste 2 gün rezervasyon yapılamaz. Bu saatlerde kort rezervasyonu boş ise saat 15:00&apos;ten itibaren yeniden rezerve edilebilir.
            </li>
            <li>
              Belirtilen bu yoğun saatler dışında, antrenman amaçlı bireysel ve tek başına rezervasyon yapılabilmesi mümkündür.
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}
