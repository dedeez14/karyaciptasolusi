import { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, CheckCircle, Bell } from 'lucide-react';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

export default function NewsletterSection() {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    const list = JSON.parse(localStorage.getItem('kcs-newsletter') || '[]');
    list.push({ email, date: new Date().toISOString() });
    localStorage.setItem('kcs-newsletter', JSON.stringify(list));
    setSubscribed(true);
    setEmail('');
  };

  return (
    <section className="relative py-20 lg:py-24 overflow-hidden">
      <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #F4B942 0%, #D4941A 50%, #F4B942 100%)' }} />
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
        backgroundSize: '30px 30px'
      }} />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }}>
          <Bell size={40} className="text-white/80 mx-auto mb-4" />
          <h2 className="text-3xl lg:text-4xl font-bold text-white mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Tetap Terupdate
          </h2>
          <p className="text-white/80 text-sm mb-8 max-w-lg mx-auto">
            Berlangganan newsletter kami untuk mendapatkan tips teknologi, promo spesial, dan update terbaru langsung di inbox Anda.
          </p>

          {subscribed ? (
            <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="flex items-center justify-center gap-2 text-white">
              <CheckCircle size={20} />
              <span className="font-semibold">Berlangganan berhasil! Terima kasih.</span>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="emailanda@gmail.com"
                required
                className="input-white"
              />
              <button type="submit" className="btn-secondary flex items-center justify-center gap-2 text-sm">
                <Send size={14} /> Subscribe
              </button>
            </form>
          )}

          <p className="text-white/50 text-[10px] mt-4">Tidak ada spam. Anda bisa berhenti berlangganan kapan saja.</p>
        </motion.div>
      </div>
    </section>
  );
}
