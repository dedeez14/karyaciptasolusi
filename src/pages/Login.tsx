import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, LogIn, ArrowLeft } from 'lucide-react';
import FloatingLabelInput from '@/components/FloatingLabelInput';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Mohon lengkapi semua field.');
      return;
    }

    setLoading(true);
    const result = await login(email, password);
    setLoading(false);

    if (result.ok) {
      navigate('/');
    } else {
      setError(result.error ?? 'Login gagal. Silakan coba lagi.');
    }
  };

  return (
    <div className="min-h-[100dvh] flex" style={{ background: 'linear-gradient(135deg, #F8FAFC 0%, #EFF6FF 50%, #DBEAFE 100%)' }}>
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url(/images/banner-light.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }} />

      {/* Left panel — decorative */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #0F4C81 0%, #1E6BAF 40%, #2563EB 100%)' }} />
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, rgba(255,255,255,0.4) 0%, transparent 60%)' }} />

        <div className="relative z-10 flex flex-col justify-center px-16 py-16 text-white">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
            <Link to="/" className="inline-flex items-center gap-2 text-white/70 hover:text-white transition-colors mb-10 text-sm">
              <ArrowLeft size={16} />
              Kembali ke Beranda
            </Link>

            <div className="flex items-center gap-3 mb-8">
              <img src="/images/logo-main.png?v=2" alt="KCS" className="w-12 h-12 object-contain rounded-xl bg-white/20 p-1.5 backdrop-blur-sm" />
              <div>
                <p className="text-white font-bold text-lg leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Karya Cipta</p>
                <p className="text-white/70 text-xs font-bold tracking-[0.15em]">SOLUSI</p>
              </div>
            </div>

            <h2 className="text-4xl font-bold mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Selamat Datang!</h2>
            <p className="text-white/70 leading-relaxed text-sm max-w-sm">
              Masuk ke akun Anda untuk mengakses layanan eksklusif dari PT Karya Cipta Solusi.
            </p>

            <div className="mt-12 space-y-5">
              {[
                { title: 'Konsultasi IT Gratis', desc: 'Dapatkan arahan dari tim expert kami.' },
                { title: 'Tools Bisnis Eksklusif', desc: 'Invoice, kontrak, dan dokumen legal.' },
                { title: 'Update Proyek Real-Time', desc: 'Pantau kemajuan proyek Anda kapan saja.' },
              ].map((item, i) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.15 }}
                  className="flex items-start gap-3"
                >
                  <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-white" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="text-xs text-white/60">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md"
        >
          <div className="lg:hidden mb-8">
            <Link to="/" className="inline-flex items-center gap-2 text-[#475569] hover:text-[#0F172A] transition-colors text-sm mb-6">
              <ArrowLeft size={16} />
              Kembali ke Beranda
            </Link>
            <div className="flex items-center gap-3">
              <img src="/images/logo-main.png?v=2" alt="KCS" className="w-10 h-10 object-contain rounded-lg" />
              <div>
                <p className="text-[#0F172A] font-bold text-base leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Karya Cipta</p>
                <p className="text-[#1D4ED8] text-xs font-bold tracking-[0.15em]">SOLUSI</p>
              </div>
            </div>
          </div>

          <div className="warm-card p-7 sm:p-9">
            <div className="mb-7">
              <h1 className="text-2xl font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Masuk</h1>
              <p className="text-[#475569] text-sm mt-1">Masukkan kredensial akun Anda</p>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm mb-5"
              >
                <span className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold">!</span>
                </span>
                {error}
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <FloatingLabelInput
                label="Email"
                type="email"
                icon={<Mail size={18} />}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />

              <FloatingLabelInput
                label="Password"
                type="password"
                icon={<Lock size={18} />}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />

              <div className="flex items-center justify-end">
                <button type="button" className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium transition-colors">
                  Lupa password?
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full h-12 text-sm gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
              >
                {loading ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <LogIn size={18} />
                )}
                {loading ? 'Memproses...' : 'Masuk'}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-[#E2E8F0] text-center">
              <p className="text-[#475569] text-sm">
                Belum punya akun?{' '}
                <Link to="/register" className="text-[#2563EB] hover:text-[#1D4ED8] font-semibold transition-colors">
                  Daftar Sekarang
                </Link>
              </p>
            </div>
          </div>

          <p className="text-center text-[#94A3B8] text-xs mt-6">
            &copy; {new Date().getFullYear()} PT Karya Cipta Solusi
          </p>
        </motion.div>
      </div>
    </div>
  );
}
