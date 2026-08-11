import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "apa-itu-pwa",
  title: "PWA: Website yang Terasa Seperti Aplikasi",
  excerpt: "Ingin punya aplikasi tapi biaya membangun untuk Android dan iOS terasa berat? Kenali PWA, jalan tengah yang membuat website bisa dipasang seperti aplikasi.",
  category: "Teknologi",
  date: "11 Juni 2026",
  isoDate: "2026-06-11",
  readTime: "5 menit",
  image: "/images/blog/teknologi-4.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Banyak pemilik bisnis ingin punya aplikasi sendiri, lalu mundur setelah tahu bahwa aplikasi biasanya harus dibangun dua kali: satu untuk Android, satu untuk iPhone. Belum lagi proses peninjauan toko aplikasi dan kewajiban merawat dua versi sekaligus. Ada jalan tengah yang sering terlewat, namanya PWA. Artikel ini menjelaskan apa itu PWA, kelebihannya, keterbatasannya, dan kapan pilihan ini masuk akal.' },
  { type: 'h2', text: 'Apa yang Membuat Sebuah Website Disebut PWA' },
  { type: 'p', text: 'PWA adalah singkatan dari Progressive Web App. Sederhananya, ini website biasa yang dibangun dengan kemampuan tambahan sehingga terasa seperti aplikasi. Pengunjung bisa memasangnya ke layar utama HP, lengkap dengan ikon sendiri. Ketika dibuka, tampilannya memenuhi layar tanpa kolom alamat browser, jadi tidak terasa seperti sedang membuka situs.' },
  { type: 'p', text: 'Analoginya seperti sebuah toko yang punya dua cara didatangi. Ruko di pinggir jalan bisa dimasuki siapa saja yang lewat, sementara gerobak keliling datang langsung ke depan rumah pelanggan setia. Barang dan pemiliknya sama, hanya cara mengaksesnya yang berbeda. PWA membuat website Anda bisa hadir dengan dua cara itu sekaligus tanpa membangun dua sistem terpisah.' },
  { type: 'h2', text: 'Kelebihan Dibanding Membangun Aplikasi Terpisah' },
  { type: 'ul', items: [
    'Satu sistem untuk semua perangkat, sehingga biaya pembangunan dan perawatan tidak berlipat.',
    'Perbaikan dan fitur baru langsung terasa oleh pengguna tanpa mereka perlu mengunduh pembaruan.',
    'Tidak melewati antrean peninjauan toko aplikasi setiap kali ada perubahan.',
    'Ukurannya ringan, cocok untuk pengguna dengan penyimpanan HP terbatas.',
    'Tetap bisa ditemukan lewat mesin pencari dan dibagikan lewat tautan biasa, hal yang tidak dimiliki aplikasi toko.',
    'Sebagian halaman yang pernah dibuka masih dapat ditampilkan meski koneksi sedang bermasalah.',
  ] },
  { type: 'h2', text: 'Keterbatasan yang Perlu Dipahami' },
  { type: 'p', text: 'PWA bukan pengganti sempurna untuk semua jenis aplikasi. Aksesnya ke fitur perangkat lebih terbatas dibanding aplikasi yang dipasang dari toko, dan dukungan untuk hal seperti notifikasi bisa berbeda antara satu sistem operasi dengan lainnya. Untuk kebutuhan berat seperti permainan tiga dimensi, pengolahan video, atau pemakaian kamera yang intensif, aplikasi konvensional masih lebih andal.' },
  { type: 'p', text: 'Ada juga soal persepsi. Sebagian pengguna menganggap kehadiran di toko aplikasi sebagai tanda kredibilitas, dan pemasangan PWA membutuhkan langkah yang belum familier bagi semua orang. Ini bisa diatasi dengan panduan singkat, tapi tetap perlu diperhitungkan.' },
  { type: 'h2', text: 'Kapan PWA Menjadi Pilihan yang Tepat' },
  { type: 'ul', items: [
    'Toko online dan katalog produk yang ingin diakses cepat oleh pelanggan berulang.',
    'Sistem pemesanan, reservasi, atau antrean yang dipakai rutin oleh pelanggan yang sama.',
    'Dashboard internal untuk memantau penjualan, stok, atau laporan harian.',
    'Alat kerja untuk staf lapangan yang butuh diakses cepat dari HP tanpa proses instalasi rumit.',
    'Bisnis yang ingin menguji kebutuhan aplikasi sebelum berinvestasi pada aplikasi penuh.',
  ] },
  { type: 'h2', text: 'Menimbang Pilihan dengan Kepala Dingin' },
  { type: 'p', text: 'Pertanyaan yang layak diajukan bukan mana yang lebih canggih, melainkan apa yang sebenarnya dibutuhkan pengguna Anda. Jika mereka mengakses layanan beberapa kali seminggu dan yang penting adalah kecepatan serta kemudahan, PWA sering sudah lebih dari cukup dengan biaya jauh lebih terkendali. Jika kebutuhannya menyentuh fitur perangkat yang dalam, barulah aplikasi terpisah layak dipertimbangkan. Mulailah dengan mendaftar tugas apa yang ingin diselesaikan pengguna, lalu pilih teknologi yang paling sederhana untuk mewujudkannya.' },
];

export default content;
