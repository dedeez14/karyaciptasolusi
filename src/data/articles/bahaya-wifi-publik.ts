import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "bahaya-wifi-publik",
  title: "Bahaya Wi-Fi Publik untuk Akun Bisnis Anda",
  excerpt: "Wi-Fi gratis memang nyaman, tetapi tidak semua jaringan layak dipercaya. Ini cara tetap produktif di luar kantor tanpa mempertaruhkan akun bisnis Anda.",
  category: "Keamanan",
  date: "5 Februari 2026",
  isoDate: "2026-02-05",
  readTime: "5 menit",
  image: "/images/blog/keamanan-4.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Wi-Fi gratis di kafe, bandara, dan lobi hotel membuat pekerjaan bisa berjalan dari mana saja. Sayangnya, tidak semua jaringan terbuka layak dipercaya sepenuhnya, sementara akun bisnis yang Anda buka di sana biasanya jauh lebih bernilai daripada akun pribadi. Artikel ini membahas apa yang membuat jaringan publik berbeda, kebiasaan aman yang mudah diterapkan, dan alternatif yang lebih tenang saat Anda bekerja di luar kantor.' },
  { type: 'h2', text: 'Bedanya dengan Wi-Fi di Kantor Anda' },
  { type: 'p', text: 'Di jaringan kantor, Anda tahu siapa pemiliknya dan kira-kira siapa saja yang terhubung. Di jaringan publik, keduanya tidak Anda ketahui. Lalu lintas data Anda melewati perangkat yang dikelola pihak lain, dan Anda tidak punya cara memastikan perangkat itu dirawat dengan baik. Ada juga risiko jaringan palsu, yaitu nama Wi-Fi yang sengaja dibuat menyerupai nama kafe atau hotel agar orang menyambung tanpa curiga. Sikap yang sehat bukan panik, melainkan memperlakukan jaringan publik seperti ruang terbuka: boleh dipakai, tetapi jangan membicarakan hal rahasia di sana.' },
  { type: 'h2', text: 'Kebiasaan Aman yang Mudah Diterapkan' },
  { type: 'ul', items: [
    'Pastikan alamat website yang Anda buka berawalan https:// dan gembok terlihat, terutama saat memasukkan password.',
    'Tunda urusan paling sensitif seperti internet banking atau akses panel hosting sampai Anda kembali ke jaringan yang dipercaya.',
    'Matikan fitur sambung otomatis ke jaringan terbuka di ponsel maupun laptop.',
    'Tanyakan nama jaringan resmi kepada petugas, jangan menebak-nebak dari daftar yang muncul di layar.',
    'Nonaktifkan berbagi file dan printer selama berada di jaringan publik.',
    'Abaikan permintaan memasang aplikasi atau sertifikat tambahan sebagai syarat agar bisa terhubung.',
    'Setelah selesai, pilih opsi lupakan jaringan agar perangkat tidak menyambung sendiri di lain waktu.',
  ] },
  { type: 'h2', text: 'Alternatif yang Lebih Tenang' },
  { type: 'p', text: 'Cara paling sederhana untuk menghindari seluruh persoalan ini adalah memakai koneksi internet ponsel Anda sendiri, baik langsung maupun dibagikan ke laptop lewat tethering. Kuota memang terpakai, tetapi jalurnya jauh lebih terkendali. Pilihan lain adalah VPN dari penyedia yang bereputasi baik, yang membungkus lalu lintas data Anda dalam terowongan terenkripsi. Perlu diingat, memakai VPN berarti memindahkan kepercayaan Anda kepada penyedia VPN tersebut. Pilih yang jelas kebijakan dan model bisnisnya, dan berhati-hatilah dengan layanan gratis yang tidak jelas asal-usulnya.' },
  { type: 'h2', text: 'Kalau Terpaksa Memakai Komputer Umum' },
  { type: 'ul', items: [
    'Gunakan mode penyamaran atau incognito agar riwayat dan sesi login tidak tertinggal.',
    'Tolak setiap tawaran menyimpan password di browser komputer tersebut.',
    'Keluar dari semua akun dan tutup seluruh jendela sebelum meninggalkan tempat.',
    'Setelah kembali ke perangkat sendiri, ganti password akun yang tadi Anda buka dan periksa daftar perangkat yang sedang login.',
  ] },
  { type: 'h2', text: 'Aturan Sederhana untuk Tim yang Sering Bepergian' },
  { type: 'p', text: 'Bila tim Anda sering bekerja dari luar kantor, sepakati satu aturan singkat yang mudah diingat: urusan berisiko rendah seperti membaca email atau membuka dokumen umum boleh dikerjakan di mana saja, sedangkan urusan berisiko tinggi seperti pembayaran, perubahan data rekening, dan pengelolaan akun administrator hanya dilakukan lewat jaringan yang dipercaya. Aturan sesederhana ini menghilangkan sebagian besar keraguan tanpa perlu pelatihan teknis apa pun.' },
  { type: 'p', text: 'Wi-Fi publik tidak perlu dihindari mati-matian. Dengan memilah mana pekerjaan yang aman dikerjakan di mana saja dan mana yang sebaiknya menunggu, Anda tetap bisa produktif di luar kantor tanpa menggadaikan akses ke akun bisnis Anda.' },
];

export default content;
