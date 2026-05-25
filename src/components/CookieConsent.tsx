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
          className="fixed bottom-0 left-0 right-0 z-50 p-4"
        >
          <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl border border-gray-100 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-start gap-3 flex-1">
              <div className="w-10 h-10 rounded-xl bg-[#0F4C81]/8 flex items-center justify-center flex-shrink-0">
                <Cookie size={20} className="text-[#0F4C81]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1A1A2E] mb-1">Penggunaan Cookie</p>
                <p className="text-xs text-[#1A1A2E]/50 leading-relaxed">
                  Kami menggunakan cookie untuk meningkatkan pengalaman browsing Anda.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
              <button
                onClick={accept}
                className="px-5 py-2.5 bg-[#0F4C81] text-white text-sm font-semibold rounded-xl hover:bg-[#1E6BAF] transition-colors"
              >
                Mengerti
              </button>
              <button
                onClick={accept}
                className="p-2.5 rounded-xl hover:bg-gray-100 transition-colors text-[#1A1A2E]/40"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
