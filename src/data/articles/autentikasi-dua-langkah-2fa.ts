import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "autentikasi-dua-langkah-2fa",
  title: "Autentikasi Dua Langkah (2FA): Perlindungan Ekstra 5 Menit",
  excerpt: "Satu pengaturan lima menit yang membuat password curian jadi tidak cukup. Pahami pilihan metode 2FA, akun yang perlu didahulukan, dan cara menyiapkan cadangan.",
  category: "Keamanan",
  date: "26 April 2026",
  isoDate: "2026-04-26",
  readTime: "4 menit",
  image: "/images/blog/keamanan-3.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Password sekuat apa pun bisa bocor lewat hal-hal di luar kendali Anda, misalnya dari layanan lain yang bermasalah. Di titik itulah autentikasi dua langkah bekerja: meskipun password Anda diketahui orang lain, mereka tetap tidak bisa masuk. Pengaturannya biasanya selesai dalam lima menit per akun. Artikel singkat ini menjelaskan cara memilih metodenya dan akun mana yang perlu didahulukan.' },
  { type: 'h2', text: 'Dua Kunci untuk Satu Pintu' },
  { type: 'p', text: 'Autentikasi dua langkah, sering disingkat 2FA, menambahkan satu lapis pemeriksaan setelah password. Analoginya seperti pintu dengan dua kunci berbeda: satu yang Anda ingat berupa password, dan satu yang Anda pegang berupa ponsel atau perangkat kecil. Seseorang yang hanya memiliki salah satunya tidak akan bisa membuka pintu. Inilah alasan 2FA sering disebut perlindungan dengan hasil terbesar dibanding usaha yang dikeluarkan.' },
  { type: 'h2', text: 'Pilihan Metode, dari yang Paling Dianjurkan' },
  { type: 'ul', items: [
    'Kunci keamanan fisik: perangkat kecil seukuran flashdisk yang dicolokkan atau ditempelkan. Paling tahan terhadap penipuan, cocok untuk akun yang paling kritis.',
    'Aplikasi authenticator: aplikasi ponsel yang menghasilkan kode enam digit dan berganti setiap beberapa puluh detik. Gratis, tetap bekerja tanpa sinyal, dan menjadi pilihan seimbang untuk kebanyakan bisnis.',
    'Notifikasi dari aplikasi resmi layanan: Anda cukup menekan tombol setuju saat ada percobaan login. Praktis, dengan satu catatan penting: jangan pernah menyetujui permintaan yang tidak Anda mulai sendiri.',
    'Kode lewat SMS: lebih baik daripada tidak ada sama sekali, tetapi paling lemah karena nomor ponsel bisa disalahgunakan. Jadikan pilihan terakhir bila metode lain tidak tersedia.',
  ] },
  { type: 'h2', text: 'Mulai dari Akun yang Paling Berdampak' },
  { type: 'ul', items: [
    'Email utama bisnis Anda.',
    'Akun domain dan hosting.',
    'Halaman admin website.',
    'Akun media sosial dan pengelola iklan.',
    'Layanan keuangan, pembayaran, dan marketplace.',
    'Penyimpanan awan yang berisi dokumen perusahaan.',
  ] },
  { type: 'p', text: 'Email utama layak didahulukan karena hampir semua akun lain memakainya sebagai jalur pemulihan password. Melindungi email berarti melindungi seluruh rantainya sekaligus.' },
  { type: 'h2', text: 'Siapkan Cadangan Sebelum Ponsel Hilang' },
  { type: 'p', text: 'Kekhawatiran paling umum tentang 2FA adalah: bagaimana kalau ponsel saya hilang atau rusak? Kekhawatiran itu wajar, dan jawabannya adalah menyiapkan cadangan sejak awal. Hampir semua layanan memberi kode pemulihan sekali pakai saat Anda mengaktifkan 2FA. Simpan kode tersebut di tempat yang tidak ikut hilang bersama ponsel, misalnya dicetak dan disimpan di laci terkunci, atau di dalam brankas password Anda. Bila memungkinkan, daftarkan lebih dari satu metode agar selalu ada jalan masuk cadangan.' },
  { type: 'h2', text: 'Untuk Akun Milik Perusahaan' },
  { type: 'p', text: 'Akun penting perusahaan sebaiknya tidak bergantung pada ponsel satu orang saja. Cara yang lebih sehat adalah memberi setiap pengelola akun administrator masing-masing dengan 2FA sendiri, bukan berbagi satu akun bersama kodenya. Dengan begitu, saat seseorang berhalangan atau berhenti bekerja, operasional tetap jalan dan aksesnya bisa dicabut tanpa mengganggu yang lain.' },
  { type: 'p', text: 'Aktifkan 2FA pada satu akun sekarang juga, dan biarkan email utama menjadi yang pertama. Catat kode cadangannya sebelum menutup halaman pengaturan. Lima menit yang Anda keluarkan hari ini bisa menghemat berhari-hari pemulihan di kemudian hari.' },
];

export default content;
