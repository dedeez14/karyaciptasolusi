import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';

export default function WhatsAppFloat() {
  return (
    <motion.a
      href="https://wa.me/6283898911244"
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 3, duration: 0.5, type: 'spring' }}
      className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-[#25D366] text-white shadow-lg shadow-[#25D366]/30 flex items-center justify-center hover:bg-[#20BD5A] transition-all duration-200 hover:scale-110 group focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:ring-offset-2"
      aria-label="Chat WhatsApp"
    >
      <MessageCircle size={26} />
      {/* Pulse ring */}
      <span className="absolute inset-0 rounded-full bg-[#25D366] animate-ping opacity-20" />
      {/* Tooltip */}
      <span className="absolute right-full mr-3 px-3 py-1.5 bg-[#1A1A2E] text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none font-medium">
        Chat WhatsApp
      </span>
    </motion.a>
  );
}
