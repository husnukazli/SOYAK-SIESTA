export function RulesView() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-3">
        <p className="text-xs font-medium text-emerald-800">Resmi Site Düzenlemesi</p>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Tenis Kortu Kullanım ve Rezervasyon Düzenlemesi
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          Korttan tüm daire sakinlerinin adil, düzenli ve kesintisiz biçimde yararlanabilmesi için aşağıdaki rezervasyon, iptal ve kullanım esasları uygulama üzerinden otomatik olarak denetlenir.
        </p>
      </div>

      {/* Quick Rule Parameters Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Özet Kural ve Yaptırım Tablosu
          </h2>
        </div>
        <div className="divide-y divide-slate-200 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-12 px-6 py-3.5 gap-2">
            <span className="sm:col-span-4 font-medium text-slate-900">Ücretsiz İptal Süresi</span>
            <span className="sm:col-span-8 text-slate-600">
              Rezervasyon başlangıcından en geç <strong className="font-mono text-slate-900">4 saat</strong> öncesine kadar cezasız iptal.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 px-6 py-3.5 gap-2">
            <span className="sm:col-span-4 font-medium text-slate-900">Geç İptal Yaptırımı</span>
            <span className="sm:col-span-8 text-slate-600">
              <strong className="font-mono text-slate-900">15 gün</strong> içinde ilk geç iptal için uyarı; tekrarı halinde <strong className="font-mono text-slate-900">1 hafta</strong> rezervasyon hakkı iptali.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 px-6 py-3.5 gap-2">
            <span className="sm:col-span-4 font-medium text-slate-900">Daire Sakini Zorunluluğu</span>
            <span className="sm:col-span-8 text-slate-600">
              İlk tespitte uyarı; tekrarı durumunda <strong className="font-mono text-slate-900">1 ay</strong> rezervasyon hakkı iptali ve yönetim inisiyatifinde ücretli ceza.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 px-6 py-3.5 gap-2">
            <span className="sm:col-span-4 font-medium text-slate-900">Günlük ve Aktif Sınır</span>
            <span className="sm:col-span-8 text-slate-600">
              Mevcut rezervasyon saati tamamlanmadan yeni kayıt açılamaz ve aynı gün içinde birden fazla rezervasyon yapılamaz.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 px-6 py-3.5 gap-2">
            <span className="sm:col-span-4 font-medium text-slate-900">Yoğun Saat Kısıtı (18:00 - 21:00)</span>
            <span className="sm:col-span-8 text-slate-600">
              Üst üste <strong className="font-mono text-slate-900">2 gün</strong> rezervasyon yapılamaz. Boş ise aynı gün saat <strong className="font-mono text-slate-900">16:00</strong> sonrasında yeniden rezerve edilebilir.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 px-6 py-3.5 gap-2">
            <span className="sm:col-span-4 font-medium text-slate-900">Bireysel Antrenman</span>
            <span className="sm:col-span-8 text-slate-600">
              18:00 - 21:00 yoğun saat aralığı dışında tek başına antrenman amaçlı rezervasyon yapılabilir.
            </span>
          </div>
        </div>
      </div>

      {/* Full Regulation Clauses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900 pb-3 border-b border-slate-200">
            01. Rezervasyon ve İptal Koşulları
          </h2>
          <ol className="space-y-4 text-sm text-slate-600 leading-relaxed list-decimal pl-4">
            <li>
              Tüm kort rezervasyonları ve iptal işlemleri çevrim içi (online) uygulama üzerinden, daire numaralarına tahsis edilen şifreler kullanılarak yapılacaktır.
            </li>
            <li>
              Rezervasyonların en geç 4 saat öncesine kadar iptal edilmesi gerekmektedir; bu süre zarfındaki iptallerde herhangi bir cezai yaptırım uygulanmayacaktır.
            </li>
            <li>
              4 saatten kısa süre kala yapılan iptaller &ldquo;geç iptal&rdquo; olarak değerlendirilecektir. 15 günlük süreç içerisinde ilk geç iptal için uyarı verilecek, tekrarı halinde ise 1 haftalık rezervasyon hakkı iptal edilecektir.
            </li>
          </ol>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900 pb-3 border-b border-slate-200">
            02. Kort Kullanım Esasları
          </h2>
          <ol className="space-y-4 text-sm text-slate-600 leading-relaxed list-decimal pl-4">
            <li>
              Kortu kullanan kişilerden en az birinin ilgili daire sakini olması zorunludur. İlk tespitte uyarı yapılır; tekrarı durumunda 1 aylık rezervasyon hakkı iptal edilir ve ücretli bir ceza uygulaması yönetimin inisiyatifindedir.
            </li>
            <li>
              Daire sakinleri, mevcut rezervasyon saati tamamlanmadan yeni bir rezervasyon oluşturamazlar. Aynı gün içinde birden fazla rezervasyon yapılamaz.
            </li>
            <li>
              Kortun müsait olması durumunda rezervasyon yapılmadan da kort kullanılabilir; fakat bu sırada kortun rezerve edilmesi halinde kort kullanım hakkı rezerve edene aittir.
            </li>
            <li>
              Saat 18:00 - 21:00 aralığında üst üste 2 gün rezervasyon yapılamaz. Bu saatlerde kort rezervasyonu boş ise saat 16:00&apos;dan itibaren yeniden rezerve edilebilir.
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
