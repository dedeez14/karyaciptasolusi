import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, CheckCircle, MessageSquare, Phone, Mail, Clock, ChevronDown, Check, Loader2, Inbox } from 'lucide-react';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

interface Pesan {
  id: number;
  nama: string;
  email: string;
  telepon: string;
  subjek: string;
  pesan: string;
  tanggal: string;
  dibaca: boolean;
}

/* ─── floating-label input wrapper ─── */
function FloatingInput({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  isTextarea = false,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  isTextarea?: boolean;
  rows?: number;
}) {
  const [focused, setFocused] = useState(false);
  const hasValue = value.length > 0;
  const isActive = focused || hasValue;

  const sharedProps = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    required,
    className: 'input-field pt-5 pb-2.5 px-4 peer',
    style: {
      borderColor: focused ? '#F4B942' : '#F0E6D3',
      boxShadow: focused ? '0 0 0 3px rgba(244, 185, 66, 0.15), 0 1px 4px rgba(244, 185, 66, 0.08)' : 'none',
    },
  };

  return (
    <div className="relative">
      <motion.label
        animate={{
          y: isActive ? -11 : 0,
          scale: isActive ? 0.78 : 1,
          color: focused ? '#D4941A' : hasValue ? '#22C55E' : '#B0A99F',
        }}
        transition={{ duration: 0.2, ease: easing }}
        className="absolute left-4 top-3.5 text-sm origin-left pointer-events-none z-10 font-medium"
      >
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </motion.label>

      {isTextarea ? (
        <textarea {...sharedProps} rows={rows} />
      ) : (
        <input type={type} {...sharedProps} />
      )}

      {/* Filled checkmark */}
      <AnimatePresence>
        {hasValue && !focused && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            className="absolute right-3 top-3.5"
          >
            <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
              <Check size={11} className="text-green-500" strokeWidth={3} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── custom select with floating label ─── */
function FloatingSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [focused, setFocused] = useState(false);
  const hasValue = value.length > 0;
  const isActive = focused || hasValue;

  return (
    <div className="relative">
      <motion.label
        animate={{
          y: isActive ? -11 : 0,
          scale: isActive ? 0.78 : 1,
          color: focused ? '#D4941A' : hasValue ? '#22C55E' : '#B0A99F',
        }}
        transition={{ duration: 0.2, ease: easing }}
        className="absolute left-4 top-3.5 text-sm origin-left pointer-events-none z-10 font-medium"
      >
        {label}
      </motion.label>

      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="input-field pt-5 pb-2.5 px-4 appearance-none cursor-pointer peer"
          style={{
            borderColor: focused ? '#F4B942' : '#F0E6D3',
            boxShadow: focused ? '0 0 0 3px rgba(244, 185, 66, 0.15), 0 1px 4px rgba(244, 185, 66, 0.08)' : 'none',
          }}
        >
          <option value="" disabled />
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-3 top-3.5 pointer-events-none transition-colors duration-200"
          style={{ color: focused ? '#D4941A' : '#B0A99F' }}
        />
      </div>

      <AnimatePresence>
        {hasValue && !focused && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            className="absolute right-8 top-3.5"
          >
            <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
              <Check size={11} className="text-green-500" strokeWidth={3} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── success confetti particles ─── */
function ConfettiBurst() {
  const colors = ['#F4B942', '#D4941A', '#0F4C81', '#22C55E', '#F97316', '#1E6BAF'];
  const particles = Array.from({ length: 16 }, (_, i) => ({
    id: i,
    angle: (360 / 16) * i + Math.random() * 20,
    distance: 40 + Math.random() * 70,
    size: 4 + Math.random() * 6,
    color: colors[i % colors.length],
  }));

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
          animate={{
            x: Math.cos((p.angle * Math.PI) / 180) * p.distance,
            y: Math.sin((p.angle * Math.PI) / 180) * p.distance,
            scale: 0,
            opacity: 0,
          }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.15 }}
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: p.size,
            height: p.size,
            background: p.color,
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
          }}
        />
      ))}
    </div>
  );
}

/* ─── main component ─── */
export default function ContactFormSection() {
  const [form, setForm] = useState({ nama: '', email: '', telepon: '', subjek: '', pesan: '' });
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const [pesanList, setPesanList] = useState<Pesan[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('kcs-pesan');
    if (saved) setPesanList(JSON.parse(saved));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nama || !form.email || !form.pesan) return;

    setIsSubmitting(true);

    // Simulate brief loading for UX
    setTimeout(() => {
      const newPesan: Pesan = {
        id: Date.now(),
        nama: form.nama,
        email: form.email,
        telepon: form.telepon,
        subjek: form.subjek || 'Umum',
        pesan: form.pesan,
        tanggal: new Date().toLocaleString('id-ID'),
        dibaca: false,
      };

      const updated = [newPesan, ...pesanList];
      setPesanList(updated);
      localStorage.setItem('kcs-pesan', JSON.stringify(updated));
      setIsSubmitting(false);
      setSubmitted(true);
      setForm({ nama: '', email: '', telepon: '', subjek: '', pesan: '' });
      setTimeout(() => setSubmitted(false), 4500);
    }, 600);
  };

  const updateField = (field: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const subjekOptions = [
    { value: 'Konsultasi', label: 'Konsultasi' },
    { value: 'Pembuatan Aplikasi', label: 'Pembuatan Aplikasi' },
    { value: 'Kerjasama', label: 'Kerjasama' },
    { value: 'Saran', label: 'Saran' },
    { value: 'Lainnya', label: 'Lainnya' },
  ];

  const infoItems = [
    { icon: MessageSquare, title: 'Respon Cepat', desc: 'Tim kami akan membalas dalam 1x24 jam', gradient: 'from-[#F4B942] to-[#D4941A]' },
    { icon: Phone, title: 'WhatsApp Langsung', desc: '0856-0177-1312 (Klik untuk chat)', gradient: 'from-[#22C55E] to-[#16A34A]' },
    { icon: Mail, title: 'Email', desc: 'febriansyahd65@gmail.com', gradient: 'from-[#0F4C81] to-[#1E6BAF]' },
    { icon: Clock, title: 'Jam Operasional', desc: 'Senin-Sabtu, 09.00-17.00 WIB', gradient: 'from-[#F97316] to-[#EA580C]' },
  ];

  return (
    <section className="relative py-24 lg:py-32 bg-white overflow-hidden">
      {/* Decorative background blobs */}
      <div className="absolute top-20 right-0 w-96 h-96 rounded-full opacity-[0.03]" style={{ background: 'radial-gradient(circle, #F4B942, transparent 70%)' }} />
      <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #0F4C81, transparent 70%)' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: easing }}
          className="text-center mb-14"
        >
          <span className="section-badge mb-3">Pesan &amp; Saran</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#2D2D3A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Kirim <span style={{ color: '#D4941A' }}>Pesan</span>
          </h2>
          <p className="text-[#6B6B7B] max-w-lg mx-auto text-sm leading-relaxed">
            Punya pertanyaan atau saran? Kirim pesan langsung ke tim kami.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-5 gap-8">
          {/* ─── Form Card ─── */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: easing }}
            className="lg:col-span-3"
          >
            <div
              className="warm-card p-6 sm:p-8 lg:p-10 relative"
              style={{
                background: 'linear-gradient(135deg, #FFFFFF 0%, #FFFBF3 100%)',
              }}
            >
              {/* Subtle gradient border glow */}
              <div
                className="absolute inset-0 rounded-2xl pointer-events-none opacity-40"
                style={{
                  background: 'linear-gradient(135deg, rgba(244,185,66,0.12), transparent 40%, rgba(15,76,129,0.08))',
                  padding: '1.5px',
                  WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                  WebkitMaskComposite: 'xor',
                  maskComposite: 'exclude',
                }}
              />

              <AnimatePresence mode="wait">
                {submitted ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.45, ease: easing }}
                    className="flex flex-col items-center justify-center py-16 text-center relative"
                  >
                    <ConfettiBurst />

                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
                    >
                      <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mb-5">
                        <motion.div
                          initial={{ pathLength: 0 }}
                          animate={{ scale: [0, 1.2, 1] }}
                          transition={{ duration: 0.5, delay: 0.2 }}
                        >
                          <CheckCircle size={44} className="text-green-500" />
                        </motion.div>
                      </div>
                    </motion.div>

                    <motion.h3
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="text-xl font-bold text-[#2D2D3A] mb-2"
                    >
                      Pesan Terkirim!
                    </motion.h3>
                    <motion.p
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                      className="text-sm text-[#6B6B7B]"
                    >
                      Terima kasih, tim kami akan segera menghubungi Anda.
                    </motion.p>
                  </motion.div>
                ) : (
                  <motion.form
                    key="form"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onSubmit={handleSubmit}
                    className="space-y-5 relative z-10"
                  >
                    <div className="grid sm:grid-cols-2 gap-5">
                      <FloatingInput
                        label="Nama Lengkap"
                        value={form.nama}
                        onChange={updateField('nama')}
                        required
                      />
                      <FloatingInput
                        label="Email"
                        type="email"
                        value={form.email}
                        onChange={updateField('email')}
                        required
                      />
                    </div>

                    <div className="grid sm:grid-cols-2 gap-5">
                      <FloatingInput
                        label="Telepon"
                        value={form.telepon}
                        onChange={updateField('telepon')}
                      />
                      <FloatingSelect
                        label="Subjek"
                        value={form.subjek}
                        onChange={updateField('subjek')}
                        options={subjekOptions}
                      />
                    </div>

                    <FloatingInput
                      label="Pesan"
                      value={form.pesan}
                      onChange={updateField('pesan')}
                      required
                      isTextarea
                      rows={5}
                    />

                    <motion.button
                      type="submit"
                      disabled={isSubmitting}
                      whileHover={!isSubmitting ? { y: -2 } : {}}
                      whileTap={!isSubmitting ? { y: 0 } : {}}
                      className="btn-primary w-full justify-center mt-2 disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                      <AnimatePresence mode="wait">
                        {isSubmitting ? (
                          <motion.span
                            key="loading"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="flex items-center gap-2"
                          >
                            <Loader2 size={16} className="animate-spin" />
                            Mengirim...
                          </motion.span>
                        ) : (
                          <motion.span
                            key="send"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="flex items-center gap-2"
                          >
                            <Send size={16} />
                            Kirim Pesan
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* ─── Info Cards + Inbox ─── */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2, ease: easing }}
            className="lg:col-span-2 space-y-4"
          >
            {infoItems.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.3 + i * 0.1, ease: easing }}
                whileHover={{ y: -4, transition: { duration: 0.25 } }}
                className="warm-card flex items-start gap-4 p-5 cursor-default group"
              >
                <motion.div
                  whileHover={{ scale: 1.15, rotate: 5 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center flex-shrink-0 shadow-md`}
                >
                  <item.icon size={20} className="text-white" />
                </motion.div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#2D2D3A] mb-0.5 group-hover:text-[#D4941A] transition-colors duration-200">
                    {item.title}
                  </p>
                  <p className="text-xs text-[#6B6B7B] leading-relaxed">{item.desc}</p>
                </div>
              </motion.div>
            ))}

            {/* Inbox Toggle */}
            <AnimatePresence>
              {pesanList.length > 0 && (
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  onClick={() => setShowInbox(!showInbox)}
                  whileHover={{ y: -2 }}
                  whileTap={{ y: 0 }}
                  className="btn-blue w-full gap-2"
                >
                  <Inbox size={16} />
                  {showInbox ? 'Sembunyikan' : 'Lihat'} Pesan Masuk ({pesanList.length})
                  <motion.div
                    animate={{ rotate: showInbox ? 180 : 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <ChevronDown size={14} />
                  </motion.div>
                </motion.button>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {showInbox && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.35, ease: easing }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                    <AnimatePresence>
                      {pesanList.map((p, idx) => (
                        <motion.div
                          key={p.id}
                          initial={{ opacity: 0, y: 10, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.97 }}
                          transition={{ duration: 0.25, delay: idx * 0.04 }}
                          className="p-4 rounded-xl bg-white border border-[#F0E6D3] hover:border-[#F4B942]/40 hover:shadow-md transition-all duration-200"
                        >
                          <div className="flex justify-between items-start mb-1">
                            <p className="text-xs font-bold text-[#2D2D3A]">{p.nama}</p>
                            <span className="text-[10px] text-[#B0A99F] whitespace-nowrap ml-2">{p.tanggal}</span>
                          </div>
                          <p className="text-[11px] font-semibold text-[#D4941A] mb-1.5">{p.subjek}</p>
                          <p className="text-xs text-[#6B6B7B] leading-relaxed line-clamp-2">{p.pesan}</p>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
