import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, User, LogOut, ChevronDown, Megaphone } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSite } from '@/lib/siteContext';
import type { SectionKey } from '@/lib/siteTypes';

const ALL_NAV_LINKS: { label: string; href: string; section?: SectionKey }[] = [
  { label: 'Beranda', href: '#beranda' },
  { label: 'Portofolio', href: '#portofolio', section: 'portfolio' },
  { label: 'Layanan', href: '#layanan', section: 'services' },
  { label: 'Konsultasi', href: '#konsultasi', section: 'consultation' },
  { label: 'Blog', href: '#blog', section: 'blog' },
  { label: 'Karir', href: '#karir', section: 'career' },
  { label: 'FAQ', href: '#faq', section: 'faq' },
  { label: 'Kontak', href: '#kontak', section: 'contact' },
];

const ANNOUNCE_KEY = 'kcs-announcement-dismissed';

export default function Navbar() {
  const { user, logout, isAuthenticated } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('#beranda');
  const { site, isHidden, waLink } = useSite();
  // Karir hanya tampil bila ada lowongan dari ERP; section lain bisa disembunyikan dari ERP.
  const jobCount = site.jobs.length;
  const navLinks = useMemo(
    () =>
      ALL_NAV_LINKS.filter(
        (l) => !l.section || (!isHidden(l.section) && (l.section !== 'career' || jobCount > 0)),
      ),
    [isHidden, jobCount],
  );
  const announcement = site.announcement;
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ANNOUNCE_KEY);
    } catch {
      return null;
    }
  });
  const showAnnouncement = !!announcement && dismissed !== announcement;
  const dismissAnnouncement = () => {
    if (!announcement) return;
    setDismissed(announcement);
    try {
      sessionStorage.setItem(ANNOUNCE_KEY, announcement);
    } catch {
      /* abaikan */
    }
  };

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
  }, [navLinks]);

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
      {showAnnouncement && (
        <div className="on-dark bg-brand-dark text-white">
          <div className="max-w-7xl mx-auto pl-4 sm:pl-6 lg:pl-8 flex items-center gap-2 min-h-[44px]">
            <Megaphone size={15} className="text-gold flex-shrink-0" aria-hidden="true" />
            <p className="flex-1 text-xs sm:text-[13px] font-medium py-2 leading-snug">{announcement}</p>
            <button
              type="button"
              onClick={dismissAnnouncement}
              className="w-11 h-11 flex items-center justify-center text-white/80 hover:text-white flex-shrink-0"
              aria-label="Tutup pengumuman"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 lg:h-20">
          <a href="#beranda" onClick={(e) => handleNavClick(e, '#beranda')} className="flex items-center gap-2.5">
            <img src="/images/logo-main.png?v=2" alt="KCS" className="w-9 h-9 object-contain rounded-lg"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div className="hidden sm:block">
              <p className="text-[#0F172A] font-bold text-sm leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Karya Cipta</p>
              <p className="text-brand text-[9px] font-bold tracking-[0.15em]">SOLUSI</p>
            </div>
          </a>

          <div className="hidden lg:flex items-center gap-0.5">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} onClick={(e) => handleNavClick(e, link.href)}
                className={`px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all ${
                  activeSection === link.href ? 'text-brand bg-brand-tint shadow-[inset_0_-2px_0_rgb(var(--gold))]' : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F8FAFC]'
                }`}>
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <div className="hidden lg:flex relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-[#0F172A] hover:bg-[#F8FAFC] transition-colors"
                >
                  <span className="w-7 h-7 rounded-full bg-brand-tint-strong text-brand flex items-center justify-center">
                    <User size={14} />
                  </span>
                  <span className="max-w-[100px] truncate">{user?.name}</span>
                  <ChevronDown size={14} className={`transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl border border-[#E2E8F0] shadow-lg py-1 z-50"
                    onMouseLeave={() => setUserMenuOpen(false)}>
                    <button
                      onClick={() => { logout(); setUserMenuOpen(false); }}
                      className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <LogOut size={14} />
                      Keluar
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link to="/login" className="hidden lg:inline-flex btn-ghost btn-small">
                Masuk
              </Link>
            )}
            <a href={waLink()} target="_blank" rel="noopener noreferrer"
              className="hidden lg:inline-flex btn-primary btn-small shadow-lg shadow-brand/25">
              Konsultasi Gratis
            </a>
            <button onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'} className="lg:hidden w-11 h-11 flex items-center justify-center rounded-xl text-[#0F172A] hover:bg-brand-tint-strong transition-colors">
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
                    activeSection === link.href ? 'text-brand bg-brand-tint shadow-[inset_3px_0_0_rgb(var(--gold))]' : 'text-[#0F172A] hover:bg-[#F8FAFC]'
                  }`}>
                  {link.label}
                </motion.a>
              ))}
              {isAuthenticated ? (
                <motion.button
                  onClick={() => { logout(); setMenuOpen(false); }}
                  initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: navLinks.length * 0.05 }}
                  className="block w-full text-left px-4 py-3 rounded-xl font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  Keluar
                </motion.button>
              ) : (
                <motion.div
                  initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: navLinks.length * 0.05 }}
                >
                  <Link to="/login" onClick={() => setMenuOpen(false)}
                    className="block px-4 py-3 rounded-xl font-medium text-[#0F172A] hover:bg-[#F8FAFC] transition-colors">
                    Masuk
                  </Link>
                  <Link to="/register" onClick={() => setMenuOpen(false)}
                    className="block px-4 py-3 rounded-xl font-medium text-[#0F172A] hover:bg-[#F8FAFC] transition-colors">
                    Daftar
                  </Link>
                </motion.div>
              )}
              <motion.a href={waLink()} target="_blank" rel="noopener noreferrer"
                initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: (navLinks.length + 1) * 0.05 }}
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
