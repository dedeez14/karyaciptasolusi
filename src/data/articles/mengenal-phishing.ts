import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "mengenal-phishing",
  title: "Mengenal Phishing: Jangan Sampai Akun Bisnis Anda Dibajak",
  excerpt: "Phishing bekerja dengan menekan emosi, bukan membobol sistem. Kenali tandanya, cara memverifikasi pesan mencurigakan, dan langkah cepat bila terlanjur mengklik.",
  category: "Keamanan",
  date: "13 Juni 2026",
  isoDate: "2026-06-13",
  readTime: "6 menit",
  image: "/images/blog/keamanan-4.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Sebuah pesan masuk dari tim dukungan yang meminta Anda segera memverifikasi akun sebelum ditutup dalam 24 jam. Tautannya membuka halaman login yang tampak persis seperti aslinya. Inilah phishing, dan cara kerjanya tidak membobol sistem, melainkan membobol perhatian Anda. Artikel ini membantu Anda mengenali tandanya lebih cepat, memverifikasi pesan mencurigakan dengan tenang, dan bertindak tepat bila terlanjur mengklik.' },
  { type: 'h2', text: 'Yang Diincar Adalah Reaksi Cepat Anda' },
  { type: 'p', text: 'Phishing adalah upaya memancing korban agar menyerahkan informasi berharga secara sukarela: password, kode OTP, data kartu, atau akses ke akun. Umpannya selalu bermain di salah satu dari empat emosi, yaitu takut, terburu-buru, penasaran, atau segan kepada figur berwenang. Bentuknya bisa email, pesan WhatsApp, SMS, pesan langsung di media sosial, bahkan telepon. Karena yang disasar adalah manusia dan bukan mesin, antivirus secanggih apa pun tidak bisa sepenuhnya menggantikan kewaspadaan Anda.' },
  { type: 'h2', text: 'Tanda Bahaya yang Perlu Dihafal' },
  { type: 'ul', items: [
    'Desakan waktu: akun akan diblokir hari ini, paket tertahan, atau tagihan jatuh tempo dalam hitungan jam.',
    'Permintaan data sensitif seperti password, kode OTP, atau foto kartu identitas. Layanan resmi tidak pernah meminta kode OTP Anda.',
    'Alamat pengirim yang mirip tetapi tidak sama persis dengan domain resmi, misalnya ada huruf tambahan atau tertukar.',
    'Teks tautan yang berbeda dengan alamat tujuan sebenarnya.',
    'Lampiran tak terduga, terutama file yang meminta Anda mengaktifkan sesuatu terlebih dahulu agar bisa dibuka.',
    'Sapaan umum tanpa nama Anda, atau susunan kalimat yang terasa seperti hasil terjemahan mentah.',
    'Tawaran yang terlalu bagus: hadiah, pengembalian dana, atau proyek besar dari pihak yang tidak pernah Anda hubungi.',
  ] },
  { type: 'h2', text: 'Cara Memverifikasi Tanpa Ikut Terjebak' },
  { type: 'ul', items: [
    'Jangan klik tautan di dalam pesan. Buka layanannya lewat alamat yang biasa Anda ketik sendiri atau lewat aplikasi resminya.',
    'Arahkan kursor ke tautan, atau tekan lama di ponsel, untuk melihat alamat tujuan sebelum membukanya.',
    'Perhatikan nama domain tepat sebelum garis miring pertama. Di situlah alamat aslinya berada, bukan di kata-kata yang mengikutinya.',
    'Bila pesan mengaku dari bank, marketplace, atau rekan kerja, konfirmasi lewat jalur lain: telepon nomor resmi atau tanyakan langsung kepada orangnya.',
    'Perlakukan permintaan mendesak di luar jam kerja dengan ekstra hati-hati, karena situasi seperti itu memang sengaja dipilih.',
  ] },
  { type: 'h2', text: 'Kalau Terlanjur Mengklik atau Mengisi Data' },
  { type: 'p', text: 'Jangan habiskan waktu untuk menyalahkan diri sendiri. Kecepatan bertindak jauh lebih menentukan daripada penyesalan.' },
  { type: 'ul', items: [
    'Segera ganti password akun terkait dari perangkat lain yang Anda percaya.',
    'Aktifkan autentikasi dua langkah bila belum aktif, agar password yang bocor tidak cukup untuk masuk.',
    'Periksa daftar perangkat atau sesi yang sedang login, lalu keluarkan yang tidak Anda kenali.',
    'Hubungi bank atau penyedia layanan bila yang terlanjur diberikan menyangkut data keuangan.',
    'Periksa apakah ada pengaturan yang diam-diam berubah, misalnya email pemulihan atau aturan penerusan pesan masuk.',
    'Beri tahu tim Anda agar mereka waspada terhadap pesan serupa yang mungkin datang berikutnya.',
  ] },
  { type: 'h2', text: 'Melindungi Tim, Bukan Hanya Diri Sendiri' },
  { type: 'p', text: 'Phishing kerap masuk lewat anggota tim yang paling jarang berurusan dengan hal teknis. Buat kesepakatan sederhana di kantor: tidak ada permintaan transfer, perubahan nomor rekening, atau pengiriman dokumen sensitif yang diproses hanya berdasarkan pesan tertulis. Semuanya harus dikonfirmasi lewat jalur kedua. Sampaikan juga bahwa siapa pun yang telanjur mengklik tautan mencurigakan boleh melapor tanpa takut dimarahi. Laporan yang cepat jauh lebih berharga daripada kesalahan yang disembunyikan sampai terlambat.' },
  { type: 'p', text: 'Bentuk phishing akan terus berganti mengikuti tren, tetapi polanya tetap sama: mendorong Anda bertindak cepat tanpa sempat berpikir. Kebiasaan berhenti sejenak dan memverifikasi lewat jalur lain adalah perlindungan paling ampuh yang bisa Anda mulai hari ini, tanpa biaya sepeser pun.' },
];

export default content;
