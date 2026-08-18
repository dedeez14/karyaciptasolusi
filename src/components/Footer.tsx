import { Link } from 'react-router-dom';
import { Phone, Mail, MapPin, ArrowUpRight, Clock } from 'lucide-react';
import { blogPosts } from '../data/blogIndex';

const quickLinks = [
  { label: 'Beranda', href: '#beranda' },
  { label: 'Tentang', href: '#tentang' },
  { label: 'Layanan', href: '#layanan' },
  { label: 'Kenapa Kami', href: '#kenapa-kami' },
  { label: 'Konsultasi', href: '#konsultasi' },
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
    <footer className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #F8FAFC 0%, #EFF6FF 50%, #DBEAFE 100%)' }}>
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url(/images/banner-light.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 relative z-10">
        <div className="grid md:grid-cols-2 lg:grid-cols-12 gap-10 lg:gap-8">
          {/* Brand */}
          <div className="lg:col-span-4">
            <div className="flex items-center gap-3 mb-5">
              <img src="/images/logo-main.png?v=2" alt="Logo PT Karya Cipta Solusi" className="w-12 h-12 object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <div>
                <p className="text-[#0F172A] font-bold text-base leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>PT Karya Cipta Solusi</p>
                <p className="text-[#1D4ED8] text-xs font-bold tracking-wider">SOLUSI TEKNOLOGI</p>
              </div>
            </div>
            <p className="text-[#475569] text-sm leading-relaxed mb-5 max-w-sm">
              Jasa pembuatan website, aplikasi custom, dan konsultasi IT di Depok, Jawa Barat — melayani klien di seluruh Indonesia.
            </p>
            <div className="flex items-center gap-2 text-sm mb-3">
              <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-pulse" />
              <span className="text-[#22c55e] font-medium text-xs">Aktif Beroperasi</span>
            </div>
            <div className="flex items-start gap-2 text-xs text-[#475569]/80">
              <Clock size={13} className="mt-0.5 flex-shrink-0 text-[#2563EB]" />
              Senin - Sabtu, 09.00 - 17.00 WIB
            </div>
          </div>

          {/* Navigasi */}
          <div className="lg:col-span-2">
            <h4 className="font-bold text-xs mb-5 text-[#475569] tracking-wider uppercase">Navigasi</h4>
            <ul className="space-y-2.5">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} onClick={(e) => handleClick(e, link.href)}
                    className="group flex items-center gap-1 text-[#475569]/70 hover:text-[#1D4ED8] text-sm transition-colors">
                    {link.label}
                    <ArrowUpRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Artikel terbaru - internal linking */}
          <div className="lg:col-span-3">
            <h4 className="font-bold text-xs mb-5 text-[#475569] tracking-wider uppercase">Artikel Terbaru</h4>
            <ul className="space-y-3">
              {blogPosts.slice(0, 3).map((post) => (
                <li key={post.slug}>
                  <Link to={`/blog/${post.slug}`}
                    className="block text-[#475569]/70 hover:text-[#1D4ED8] text-sm leading-snug transition-colors">
                    {post.title}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/blog" className="inline-flex items-center gap-1 text-[#1D4ED8] text-xs font-bold hover:gap-1.5 transition-all">
                  Lihat Semua Artikel <ArrowUpRight size={12} />
                </Link>
              </li>
            </ul>
          </div>

          {/* Kontak */}
          <div className="lg:col-span-3">
            <h4 className="font-bold text-xs mb-5 text-[#475569] tracking-wider uppercase">Hubungi Kami</h4>
            <ul className="space-y-3">
              {[
                { icon: Phone, val: '0838-9891-1244', href: 'tel:083898911244' },
                { icon: Mail, val: 'pt.karyaciptasolusi@gmail.com', href: 'mailto:pt.karyaciptasolusi@gmail.com' },
              ].map((c) => (
                <li key={c.val}>
                  <a href={c.href} className="flex items-start gap-3 text-[#475569]/70 hover:text-[#1D4ED8] text-sm transition-colors">
                    <c.icon size={15} className="mt-0.5 flex-shrink-0 text-[#2563EB]" />
                    {c.val}
                  </a>
                </li>
              ))}
              <li className="flex items-start gap-3 text-[#475569]/70 text-sm">
                <MapPin size={15} className="mt-0.5 flex-shrink-0 text-[#2563EB]" />
                Kp. Sindangkarsa, RT.05/RW.15, Sukamaju Baru, Tapos, Depok 16455
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-12 pt-6 border-t border-[#E2E8F0]">
          <nav aria-label="Tautan legal" className="flex flex-wrap justify-center gap-x-5 gap-y-2 mb-5">
            <Link to="/kebijakan-privasi" className="text-[#475569]/70 hover:text-[#1D4ED8] text-xs transition-colors">
              Kebijakan Privasi
            </Link>
            <Link to="/syarat-ketentuan" className="text-[#475569]/70 hover:text-[#1D4ED8] text-xs transition-colors">
              Syarat &amp; Ketentuan
            </Link>
            <Link to="/penghapusan-data" className="text-[#475569]/70 hover:text-[#1D4ED8] text-xs transition-colors">
              Penghapusan Data
            </Link>
            <Link to="/blog" className="text-[#475569]/70 hover:text-[#1D4ED8] text-xs transition-colors">
              Blog
            </Link>
          </nav>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[#475569]/50 text-xs">&copy; {new Date().getFullYear()} PT Karya Cipta Solusi. Hak Cipta Dilindungi.</p>
          <p className="text-[#475569]/40 text-xs">Jasa Pembuatan Website &amp; Aplikasi — Depok, Jawa Barat</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
