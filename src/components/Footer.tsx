import { Phone, Mail, MapPin, ArrowUpRight } from 'lucide-react';

const quickLinks = [
  { label: 'Beranda', href: '#beranda' },
  { label: 'Tentang', href: '#tentang' },
  { label: 'Layanan', href: '#layanan' },
  { label: 'Portofolio', href: '#portofolio' },
  { label: 'Testimoni', href: '#testimoni' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Kontak', href: '#kontak' },
];

export default function Footer() {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <footer className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #FFFBF3 0%, #FFF8E7 50%, #FEF3D6 100%)' }}>
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url(/images/banner-light.png)', backgroundSize: 'cover', backgroundPosition: 'center' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 relative z-10">
        <div className="grid md:grid-cols-2 lg:grid-cols-12 gap-10 lg:gap-8">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-3 mb-5">
              <img src="/images/logo-main.png" alt="KCS" className="w-12 h-12 object-contain rounded-lg"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <div>
                <p className="text-[#2D2D3A] font-bold text-base leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>PT Karya Cipta Solusi</p>
                <p className="text-[#D4941A] text-xs font-bold tracking-wider">SOLUSI TEKNOLOGI</p>
              </div>
            </div>
            <p className="text-[#6B6B7B] text-sm leading-relaxed mb-5 max-w-sm">
              Perusahaan konsultasi IT, pengembangan aplikasi, software, SaaS platform, dan pengolahan data di Depok, Jawa Barat.
            </p>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-pulse" />
              <span className="text-[#22c55e] font-medium text-xs">Aktif Beroperasi</span>
            </div>
          </div>

          <div className="lg:col-span-3 lg:col-start-7">
            <h4 className="font-bold text-xs mb-5 text-[#6B6B7B] tracking-wider uppercase">Navigasi</h4>
            <ul className="space-y-2.5">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} onClick={(e) => handleClick(e, link.href)}
                    className="group flex items-center gap-1 text-[#6B6B7B]/70 hover:text-[#D4941A] text-sm transition-colors">
                    {link.label}
                    <ArrowUpRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-3">
            <h4 className="font-bold text-xs mb-5 text-[#6B6B7B] tracking-wider uppercase">Hubungi Kami</h4>
            <ul className="space-y-3">
              {[
                { icon: Phone, val: '0856-0177-1312', href: 'tel:085601771312' },
                { icon: Phone, val: '0838-9891-1244', href: 'tel:083898911244' },
                { icon: Mail, val: 'febriansyahd65@gmail.com', href: 'mailto:febriansyahd65@gmail.com' },
              ].map((c) => (
                <li key={c.val}>
                  <a href={c.href} className="flex items-start gap-3 text-[#6B6B7B]/70 hover:text-[#D4941A] text-sm transition-colors">
                    <c.icon size={15} className="mt-0.5 flex-shrink-0 text-[#F4B942]" />
                    {c.val}
                  </a>
                </li>
              ))}
              <li className="flex items-start gap-3 text-[#6B6B7B]/70 text-sm">
                <MapPin size={15} className="mt-0.5 flex-shrink-0 text-[#F4B942]" />
                Kp. Sindangkarsa, RT.05/RW.15, Sukamaju Baru, Tapos, Depok 16455
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-[#F0E6D3] flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[#6B6B7B]/50 text-xs">&copy; {new Date().getFullYear()} PT Karya Cipta Solusi. Hak Cipta Dilindungi.</p>
          <p className="text-[#6B6B7B]/30 text-xs">Dibuat dengan dedikasi di Depok, Jawa Barat</p>
        </div>
      </div>
    </footer>
  );
}
