import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';

const navLinks = [
  { label: 'Beranda', href: '#beranda' },
  { label: 'Tentang', href: '#tentang' },
  { label: 'Layanan', href: '#layanan' },
  // { label: 'Portofolio', href: '#portofolio' },
  { label: 'Konsultasi', href: '#konsultasi' },
  { label: 'Blog', href: '#blog' },
  // { label: 'Karir', href: '#karir' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Kontak', href: '#kontak' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('#beranda');

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
      const sections = navLinks.map((l) => l.href.slice(1));
      for (let i = sections.length - 1; i >= 0; i--) {
        const el = document.getElementById(sections[i]);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 150) { setActiveSection('#' + sections[i]); break; }
        }
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    setMenuOpen(false);
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <nav className={`fixed top-[3px] left-0 right-0 z-50 transition-all duration-500 ${
      scrolled ? 'bg-white/95 backdrop-blur-xl shadow-sm' : 'bg-transparent'
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 lg:h-20">
          <a href="#beranda" onClick={(e) => handleNavClick(e, '#beranda')} className="flex items-center gap-2.5">
            <img src="/images/logo-main.png?v=2" alt="KCS" className="w-9 h-9 object-contain rounded-lg"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div className="hidden sm:block">
              <p className="text-[#0F172A] font-bold text-sm leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Karya Cipta</p>
              <p className="text-[#1D4ED8] text-[9px] font-bold tracking-[0.15em]">SOLUSI</p>
            </div>
          </a>

          <div className="hidden lg:flex items-center gap-0.5">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} onClick={(e) => handleNavClick(e, link.href)}
                className={`px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all ${
                  activeSection === link.href ? 'text-[#1D4ED8] bg-[#DBEAFE]' : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F8FAFC]'
                }`}>
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <a href="https://wa.me/6283898911244" target="_blank" rel="noopener noreferrer"
              className="hidden lg:inline-flex btn-primary btn-small shadow-lg shadow-[#2563EB]/25">
              Konsultasi Gratis
            </a>
            <button onClick={() => setMenuOpen(!menuOpen)} className="lg:hidden p-2.5 rounded-xl text-[#0F172A] hover:bg-[#DBEAFE] transition-colors">
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }} className="lg:hidden bg-white/98 backdrop-blur-xl border-t border-[#E2E8F0] overflow-hidden shadow-lg">
            <div className="px-4 py-4 space-y-1 max-h-[70vh] overflow-y-auto">
              {navLinks.map((link, i) => (
                <motion.a key={link.href} href={link.href} onClick={(e) => handleNavClick(e, link.href)}
                  initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                  className={`block px-4 py-3 rounded-xl font-medium transition-colors ${
                    activeSection === link.href ? 'text-[#1D4ED8] bg-[#DBEAFE]' : 'text-[#0F172A] hover:bg-[#F8FAFC]'
                  }`}>
                  {link.label}
                </motion.a>
              ))}
              <motion.a href="https://wa.me/6283898911244" target="_blank" rel="noopener noreferrer"
                initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: navLinks.length * 0.05 }}
                className="block px-4 py-3 mt-2 btn-primary text-center">
                Konsultasi Gratis
              </motion.a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
