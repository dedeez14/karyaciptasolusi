import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "apa-itu-payment-gateway",
  title: "Apa Itu Payment Gateway dan Cara Memilihnya",
  excerpt: "Penjelasan sederhana tentang cara kerja payment gateway, bedanya dengan transfer manual, dan hal apa saja yang perlu Anda bandingkan sebelum memilih.",
  category: "Toko Online",
  date: "5 Juli 2026",
  isoDate: "2026-07-05",
  readTime: "6 menit",
  image: "/images/blog/toko-online-3.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Kalau Anda pernah mendengar istilah payment gateway saat berdiskusi soal toko online dan hanya mengangguk sopan tanpa benar-benar paham, artikel ini untuk Anda. Istilahnya terdengar rumit, padahal konsepnya sederhana. Memahaminya penting karena pilihan Anda di bagian ini memengaruhi kenyamanan pembeli sekaligus beban kerja Anda setiap hari.' },
  { type: 'h2', text: 'Analogi Paling Mudah' },
  { type: 'p', text: 'Bayangkan kasir di toko fisik. Saat pelanggan membayar, kasir menerima uang, memastikan jumlahnya benar, memberi struk, lalu mencatat transaksi. Payment gateway adalah kasir digital untuk toko online Anda. Ia menampilkan pilihan cara bayar, menerima instruksi pembayaran dari pembeli, meneruskannya ke bank atau penyedia dompet digital, lalu memberi tahu toko Anda apakah pembayarannya berhasil. Semua itu terjadi dalam hitungan detik, tanpa Anda harus mengecek mutasi rekening satu per satu.' },
  { type: 'h2', text: 'Bedanya dengan Transfer Manual' },
  { type: 'p', text: 'Banyak penjual memulai dengan cara paling sederhana: mencantumkan nomor rekening, meminta pembeli mengirim bukti transfer, lalu memeriksanya sendiri. Cara ini gratis dan tidak butuh pengaturan apa pun. Masalahnya muncul saat volume pesanan naik.' },
  { type: 'ul', items: [
    'Anda harus mengecek dan mencocokkan pembayaran secara manual, sering kali di luar jam kerja.',
    'Nominal transfer yang sama persis dari dua pembeli berbeda mudah tertukar.',
    'Bukti transfer bisa dipalsukan, sehingga Anda tetap perlu memverifikasi ke rekening.',
    'Pesanan tertahan sampai Anda sempat memeriksa, dan pembeli menunggu tanpa kepastian.',
    'Pembeli yang terburu-buru bisa membatalkan niat karena prosesnya terasa merepotkan.',
  ] },
  { type: 'p', text: 'Payment gateway memindahkan semua pekerjaan pencocokan itu ke sistem. Sebagai gantinya, ada biaya layanan yang dipotong dari setiap transaksi. Besarannya berbeda antar penyedia dan antar metode pembayaran, jadi selalu tanyakan rinciannya langsung ke penyedia yang Anda pertimbangkan.' },
  { type: 'h2', text: 'Kanal Pembayaran yang Biasa Tersedia' },
  { type: 'p', text: 'Sebagian besar penyedia di Indonesia menawarkan kombinasi dari beberapa kanal berikut. Anda bisa memilih mengaktifkan sebagian saja sesuai kebiasaan pelanggan Anda.' },
  { type: 'ul', items: [
    'QRIS, kode yang dipindai pembeli lewat aplikasi bank atau dompet digital pilihan mereka.',
    'Virtual account, nomor rekening unik per transaksi sehingga pencocokan otomatis dan tidak tertukar.',
    'Dompet digital yang sudah umum dipakai sehari-hari.',
    'Kartu kredit dan kartu debit, terutama relevan bila produk Anda bernilai lebih tinggi.',
    'Pembayaran di gerai ritel, berguna untuk pembeli yang lebih nyaman membayar tunai.',
  ] },
  { type: 'h2', text: 'Hal yang Perlu Dibandingkan Sebelum Memilih' },
  { type: 'p', text: 'Jangan hanya membandingkan biaya per transaksi. Beberapa faktor berikut sama pentingnya dan sering baru terasa setelah toko berjalan.' },
  { type: 'ul', items: [
    'Legalitas dan izin. Pastikan penyedia terdaftar dan diawasi otoritas yang berwenang di Indonesia.',
    'Jeda pencairan dana. Berapa lama uang dari pembeli sampai ke rekening usaha Anda, karena ini memengaruhi arus kas.',
    'Kualitas dukungan teknis. Saat pembayaran bermasalah di jam sibuk, Anda perlu bantuan yang bisa dihubungi.',
    'Kemudahan integrasi. Apakah penyedia menyediakan dokumentasi yang jelas dan mudah dipasang di platform toko Anda.',
    'Pengalaman pembeli. Apakah halaman pembayarannya cepat dan nyaman dibuka di ponsel.',
  ] },
  { type: 'h2', text: 'Soal Keamanan' },
  { type: 'p', text: 'Satu manfaat yang jarang dibahas: dengan payment gateway, data sensitif seperti nomor kartu tidak pernah tersimpan di server toko Anda. Semuanya ditangani penyedia yang memang tersertifikasi untuk itu. Bagi penjual kecil, ini melepaskan tanggung jawab keamanan yang sangat berat kalau harus ditangani sendiri.' },
  { type: 'p', text: 'Jika Anda masih ragu apakah toko Anda sudah cukup ramai untuk beralih dari transfer manual, PT Karya Cipta Solusi terbuka untuk berdiskusi lewat konsultasi gratis dan membantu memetakan pilihan yang paling masuk akal untuk skala bisnis Anda.' },
];

export default content;
