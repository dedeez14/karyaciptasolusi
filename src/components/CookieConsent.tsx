import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cookie, X } from 'lucide-react';

export default function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const accepted = localStorage.getItem('kcs-cookie-accepted');
    if (!accepted) {
      const timer = setTimeout(() => setShow(true), 4000);
      return () => clearTimeout(timer);
    }
  }, []);

  const accept = () => {
    localStorage.setItem('kcs-cookie-accepted', 'true');
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          transition={{ duration: 0.4 }}
          className="fixed bottom-4 left-4 z-50 max-w-sm pr-4 sm:pr-0"
        >
          <div className="bg-white rounded-2xl shadow-2xl border border-[#E2E8F0] p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
                <Cookie size={18} className="text-[#1D4ED8]" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-[#0F172A] mb-0.5">Penggunaan Cookie</p>
                <p className="text-xs text-[#475569] leading-relaxed">
                  Kami menggunakan cookie untuk meningkatkan pengalaman browsing Anda.
                </p>
              </div>
              <button
                onClick={accept}
                aria-label="Tutup"
                className="p-1.5 -mt-1 -mr-1 rounded-lg hover:bg-[#F8FAFC] transition-colors text-[#475569]/50"
              >
                <X size={14} />
              </button>
            </div>
            <button
              onClick={accept}
              className="mt-3 w-full px-4 py-2 bg-[#1D4ED8] text-white text-xs font-bold rounded-xl hover:bg-[#1E40AF] transition-colors"
            >
              Mengerti
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
