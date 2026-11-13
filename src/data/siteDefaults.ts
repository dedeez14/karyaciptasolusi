import type { SiteContent } from '../lib/siteTypes';

/**
 * Konten bawaan situs. Dipakai saat render pertama dan setiap kali ERP tidak
 * bisa dihubungi / VITE_CMS_URL tidak diisi / sebuah field dari ERP kosong.
 * index.html (JSON-LD) menyalin sebagian nilai ini: jaga agar tetap sama.
 */
export const SITE_DEFAULTS: SiteContent = {
  updatedAt: null,

  company: {
    name: 'PT Karya Cipta Solusi',
    phone: '0838-9891-1244',
    whatsapp: '6283898911244',
    email: 'pt.karyaciptasolusi@gmail.com',
    address: 'Kp. Sindangkarsa, RT.05/RW.15\nKel. Sukamaju Baru, Kec. Tapos\nKota Depok, Jawa Barat 16455',
    mapsUrl: 'https://maps.app.goo.gl/4EexXJFYvVogySuq8',
    mapsEmbedUrl:
      'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d15859.189!2d106.9!3d-6.4!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zNsKwMjQnMDAuMCJTIDEwNsKwNTQnMDAuMCJF!5e0!3m2!1sid!2sid!4v1',
    hours: ['Senin - Jumat: 09.00 - 17.00 WIB', 'Sabtu: 09.00 - 14.00 WIB', 'Minggu & Hari Libur: Tutup'],
    social: {},
  },

  hero: {
    badge: 'Solusi Teknologi Terpercaya',
    title: 'Jasa Pembuatan\n*Website* &\nAplikasi untuk\nBisnis Anda.',
    subtitle:
      'PT Karya Cipta Solusi adalah partner transformasi digital Anda jasa pembuatan website company profile, toko online, aplikasi custom, hingga konsultasi IT untuk mempercepat pertumbuhan bisnis Anda.',
    typing: [
      'Website Company Profile',
      'Toko Online & E-Commerce',
      'Aplikasi Web & Mobile Custom',
      'Konsultasi IT Profesional',
      'Platform SaaS Terintegrasi',
    ],
    ctaText: 'Mulai Proyek',
  },

  announcement: null,
  hiddenSections: [],

  services: [
    {
      title: 'Konsultasi IT',
      desc: 'Konsultasi teknologi informasi, manajemen infrastruktur IT, dan perencanaan digital transformation.',
      icon: 'messages-square',
      image: '/images/service-consulting.jpg',
      link: null,
    },
    {
      title: 'Pembuatan Website & Aplikasi',
      desc: 'Jasa pembuatan website company profile, toko online, serta aplikasi web, mobile, dan desktop sesuai kebutuhan bisnis Anda.',
      icon: 'globe',
      image: '/images/service-programming.jpg',
      link: null,
    },
    {
      title: 'Penerbitan Software',
      desc: 'Penjualan lisensi dan distribusi produk software untuk bisnis.',
      icon: 'package',
      image: '/images/service-software.jpg',
      link: null,
    },
    {
      title: 'Platform SaaS',
      desc: 'Penyediaan platform web dan layanan Software as a Service untuk komersial.',
      icon: 'cloud',
      image: '/images/service-saas.jpg',
      link: null,
    },
    {
      title: 'Pengolahan Data',
      desc: 'Infrastruktur, hosting, database, dan jasa pengolahan data.',
      icon: 'database',
      image: '/images/service-data.jpg',
      link: null,
    },
  ],

  portfolio: [
    {
      title: 'MOVERA ERP',
      summary: 'ERP multi-perusahaan: pembelian, penjualan, persediaan, akuntansi, HRD, POS, dan modul proyek.',
      category: 'ERP',
      url: 'https://erp.karyaciptasolusi.com/',
      image: '/images/portofolio/movera.png',
      tech: ['Laravel 12', 'MySQL', 'Multi-tenant'],
    },
    {
      title: 'Bengkel ERP',
      summary: 'Job-shop bengkel bubut: customer → gambar → SPK shop-floor realtime → QC, plus situs perusahaan.',
      category: 'ERP',
      url: 'https://bengkel.karyaciptasolusi.com/',
      image: '/images/portofolio/bengkel.png',
      tech: ['Go', 'React', 'PostgreSQL'],
    },
    {
      title: 'SIBUMDes',
      summary: 'Sistem informasi BUM Desa: tata kelola, permodalan, unit usaha, pembukuan, pelaporan, dan portal desa.',
      category: 'Pemerintahan',
      url: 'https://bumdes.karyaciptasolusi.com/',
      image: '/images/portofolio/bumdes.png',
      tech: ['Go', 'React', 'PostgreSQL'],
    },
    {
      title: 'SISKOMEPU — Koperasi Simpan Pinjam',
      summary: 'Keanggotaan, simpanan, siklus pinjaman, akuntansi & SHU, dan portal anggota.',
      category: 'Keuangan',
      url: 'https://ksp.karyaciptasolusi.com/',
      image: '/images/portofolio/ksp.png',
      tech: ['Go', 'React', 'MySQL'],
    },
    {
      title: 'Sistem Manajemen Sekolah',
      summary: 'Multi-sekolah dengan 6 peran: siswa, guru, kelas, jadwal, absensi, rapor otomatis, dan keuangan sekolah.',
      category: 'Pendidikan',
      url: 'https://sekolah.karyaciptasolusi.com/',
      image: '/images/portofolio/sekolah.png',
      tech: ['Laravel 12', 'MySQL', 'Tailwind 4'],
    },
    {
      title: 'Macco — Aplikasi Akuntansi',
      summary: 'Jurnal, buku besar, rekonsiliasi bank, aset tetap, tutup buku, laporan keuangan, dan pajak UMKM.',
      category: 'Keuangan',
      url: 'https://macco.karyaciptasolusi.com/',
      image: '/images/portofolio/macco.png',
      tech: ['Go', 'React', 'PostgreSQL'],
    },
    {
      title: 'FleetCtl — Monitoring VPS',
      summary: 'Kelola banyak VPS sebagai satu fleet: metrik realtime, akses, firewall, cron, dan audit.',
      category: 'DevOps',
      url: 'https://monitoring.karyaciptasolusi.com/',
      image: '/images/portofolio/monitoring.png',
      tech: ['Go', 'Next.js', 'TimescaleDB'],
    },
  ],

  testimonials: [
    { name: 'Budi Santoso', role: 'Owner, Toko Serba Ada', content: 'KCS membantu kami membuat sistem POS yang sangat membantu operasional toko. Pelayanan cepat dan hasilnya memuaskan. Timnya sangat responsif terhadap setiap request perubahan.', rating: 5 },
    { name: 'Siti Rahayu', role: 'Manager, Lembaga Bimbel Cerdas', content: 'Platform e-learning yang dibuat sangat user-friendly. Siswa dan guru kami sangat terbantu dengan fitur yang lengkap. Proses development juga transparan dari awal sampai akhir.', rating: 5 },
    { name: 'Andi Wijaya', role: 'Direktur, PT Sejahtera Abadi', content: 'Konsultasi IT dari KCS sangat profesional. Mereka menganalisis kebutuhan kami dengan baik dan memberikan solusi tepat sasaran. Hasilnya melebihi ekspektasi kami.', rating: 5 },
    { name: 'Dewi Kusuma', role: 'Kepala Desa Digital', content: 'Sistem informasi desa yang dikembangkan sangat membantu administrasi kami. Data tersusun rapi dan mudah diakses. Warga desa juga sangat terbantu dengan layanan digital ini.', rating: 5 },
    { name: 'Rudi Hartono', role: 'Founder, Startup Agritech Nusantara', content: 'KCS built our entire SaaS platform from scratch dengan kualitas yang luar biasa. Mereka tidak hanya mengikuti spesifikasi, tapi juga memberikan banyak saran improvement yang sangat berharga.', rating: 5 },
    { name: 'Maya Indah', role: 'Operations Manager, Logistik Express', content: 'Sistem tracking dan manajemen pengiriman yang dibuat KCS meningkatkan efisiensi operasional kami hingga 40%. Dashboard analytics-nya sangat informatif dan mudah dipahami.', rating: 5 },
  ],

  faqs: [
    { q: 'Layanan apa saja yang ditawarkan?', a: 'Kami menawarkan 5 layanan utama: Konsultasi IT, Jasa Pembuatan Website & Pengembangan Aplikasi, Penerbitan Software, Platform Digital & SaaS, serta Layanan Pengolahan Data dan Hosting.' },
    { q: 'Website seperti apa yang bisa dibuat?', a: 'Kami melayani jasa pembuatan website company profile, toko online (e-commerce), landing page, sistem informasi, hingga aplikasi web custom — semuanya responsif, cepat, dan SEO friendly.' },
    { q: 'Berapa biaya jasa pembuatan website?', a: 'Biaya pembuatan website menyesuaikan kebutuhan Anda — jumlah halaman, fitur, dan kompleksitasnya. Konsultasikan kebutuhan Anda secara gratis, lalu kami susun penawaran transparan tanpa biaya tersembunyi.' },
    { q: 'Berapa lama waktu pengerjaan proyek?', a: 'Aplikasi sederhana memakan waktu 2-4 minggu, proyek kompleks 2-3 bulan. Kami berikan estimasi setelah diskusi kebutuhan.' },
    { q: 'Apakah menerima proyek dari luar Depok?', a: 'Tentu! Kami melayani klien dari seluruh Indonesia. Proses development secara remote, komunikasi via video call/email/WhatsApp.' },
    { q: 'Bagaimana sistem pembayarannya?', a: 'Sistem bertahap: 30% DP, 40% di tengah proyek (demo/MVP), 30% sisanya setelah proyek selesai di-deploy.' },
    { q: 'Apakah ada garansi setelah proyek selesai?', a: 'Ya, garansi bug fixing 1 bulan setelah deploy. Tersedia juga paket maintenance bulanan.' },
    { q: 'Bisa konsultasi dulu sebelum memutuskan?', a: 'Tentu! Kami menyediakan konsultasi gratis. Hubungi kami via WhatsApp atau telepon.' },
    { q: 'Apakah ide dan data bisnis saya aman?', a: 'Aman. Kerahasiaan ide dan data klien kami jaga penuh, dan kami siap menandatangani perjanjian kerahasiaan (NDA) bila diperlukan.' },
  ],

  clients: [
    { name: 'Kemendikdasmen', logo: '/images/clients/kemendikdasmen.png', url: null },
    { name: 'FDS Group', logo: '/images/clients/fdsgroup.png', url: null },
    { name: 'Taufiq Accounting & Tax Report', logo: '/images/clients/tatreport.png', url: null },
    { name: 'Hisabuna', logo: '/images/clients/hisabuna.svg', url: null },
    { name: 'Ask Creative', logo: '/images/clients/askcreative.png', url: null },
    { name: 'Taman Midi Anggun', logo: '/images/clients/tamanmidianggun.png', url: null },
    { name: 'Latvo', logo: '/images/clients/latvo.png', url: null },
  ],

  stats: [
    { value: 5, prefix: '', suffix: '', label: 'Bidang', sub: 'Layanan Utama', icon: 'briefcase' },
    { value: 30, prefix: '', suffix: '+', label: 'Proyek', sub: 'Terselesaikan', icon: 'code' },
    { value: 12, prefix: '', suffix: '+', label: 'Klien', sub: 'Terpercaya', icon: 'users' },
    { value: 1, prefix: '', suffix: '+', label: 'Tahun', sub: 'Pengalaman', icon: 'calendar' },
  ],

  reasons: [
    { icon: 'badge-check', title: 'Badan Usaha Resmi (PT)', desc: 'Terdaftar resmi sebagai Perseroan Terbatas — kerja sama Anda dilindungi kontrak yang jelas dan legal.' },
    { icon: 'wallet', title: 'Bayar Bertahap, Bukan di Muka', desc: 'DP 30%, 40% saat demo/MVP, sisanya setelah selesai. Anda tidak pernah membayar penuh sebelum melihat hasil.' },
    { icon: 'shield-check', title: 'Garansi Bug Fixing 1 Bulan', desc: 'Setelah aplikasi live, bug yang muncul kami perbaiki gratis selama 1 bulan penuh — tanpa biaya tambahan.' },
    { icon: 'file-code-2', title: 'Source Code Milik Anda', desc: 'Setelah pelunasan, seluruh source code dan dokumentasi diserahkan. Anda tidak terkunci pada kami.' },
    { icon: 'message-circle', title: 'Respon Maksimal 1x24 Jam', desc: 'Komunikasi langsung via WhatsApp dengan tim yang mengerjakan proyek Anda — bukan bot atau call center.' },
    { icon: 'eye', title: 'Progres Transparan', desc: 'Anda melihat demo/MVP di tengah pengerjaan dan menerima update progres rutin sampai proyek selesai.' },
  ],

  steps: [
    { icon: 'messages-square', title: 'Konsultasi Gratis', desc: 'Ceritakan kebutuhan dan tujuan bisnis Anda. Kami bantu petakan solusi teknologi yang paling tepat, tanpa biaya.' },
    { icon: 'file-text', title: 'Penawaran Custom', desc: 'Dari hasil diskusi, kami susun penawaran dengan lingkup kerja dan harga yang menyesuaikan kebutuhan serta anggaran Anda.' },
    { icon: 'rocket', title: 'Pengerjaan & Support', desc: 'Setelah sepakat, tim kami mulai bekerja dengan progres transparan hingga solusi berjalan dan tetap kami dampingi.' },
  ],

  /* Lowongan hanya tampil bila ERP mengirimkannya. */
  jobs: [],
};

/** Gambar portofolio bawaan per slug (public/images/portofolio/<slug>.png). */
export const PORTFOLIO_SLUGS = ['movera', 'bengkel', 'bumdes', 'ksp', 'sekolah', 'macco', 'monitoring'] as const;
