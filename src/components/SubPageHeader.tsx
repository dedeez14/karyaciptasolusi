import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function SubPageHeader({ subtitle }: { subtitle: string }) {
  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-[#E2E8F0]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group">
          <img src="/images/logo-main.png?v=2" alt="KCS" className="w-9 h-9 object-contain rounded-lg"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div>
            <p className="text-[#0F172A] font-bold text-sm leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{subtitle}</p>
            <p className="text-[#1D4ED8] text-[9px] font-bold tracking-[0.15em] uppercase">PT Karya Cipta Solusi</p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/" className="btn-ghost btn-small">
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Beranda</span>
          </Link>
          <a href="https://wa.me/6283898911244?text=Halo,%20saya%20ingin%20konsultasi%20gratis" target="_blank" rel="noopener noreferrer" className="btn-primary btn-small">
            Konsultasi Gratis
          </a>
        </div>
      </div>
    </header>
  );
}
