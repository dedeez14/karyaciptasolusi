import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "tips-mengelola-stok-produk-online",
  title: "Tips Mengelola Stok Produk agar Tidak Kacau Saat Ramai",
  excerpt: "Cara menata stok toko online supaya tidak terjadi penjualan barang kosong, mulai dari penamaan kode produk hingga sinkronisasi antar kanal penjualan.",
  category: "Toko Online",
  date: "18 Mei 2026",
  isoDate: "2026-05-18",
  readTime: "5 menit",
  image: "/images/blog/toko-online-2.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Mimpi buruk penjual online bukan sepi pesanan, melainkan pesanan membanjir lalu ketahuan barangnya habis. Anda harus menghubungi pembeli satu per satu, menawarkan pengembalian dana, dan menerima ulasan kecewa yang bertahan lama di halaman toko. Kekacauan semacam ini hampir selalu berakar pada pengelolaan stok yang belum tertata, bukan pada niat buruk penjual. Berikut cara membereskannya sebelum masa ramai berikutnya datang.' },
  { type: 'h2', text: 'Mulai dari Penamaan yang Disiplin' },
  { type: 'p', text: 'Setiap barang perlu kode unik yang disebut SKU, singkatan dari stock keeping unit. Anggap saja seperti nomor induk untuk tiap varian barang. Kaos merah ukuran L dan kaos merah ukuran XL adalah dua SKU berbeda, bukan satu produk dengan dua catatan di kepala Anda. Susun kodenya dengan pola yang konsisten dan bisa dibaca manusia, misalnya menggabungkan singkatan jenis produk, warna, lalu ukuran. Begitu pola ini dipakai di semua tempat, mencocokkan data dari gudang, catatan penjualan, dan halaman toko jadi jauh lebih cepat.' },
  { type: 'h2', text: 'Satukan Sumber Kebenaran' },
  { type: 'p', text: 'Masalah terbesar muncul ketika Anda berjualan di beberapa tempat sekaligus, misalnya toko sendiri, marketplace, dan pesanan lewat pesan langsung. Kalau setiap kanal punya catatan stoknya sendiri, tabrakan tinggal menunggu waktu.' },
  { type: 'ul', items: [
    'Tentukan satu tempat sebagai catatan resmi, dan perlakukan yang lain sebagai turunan.',
    'Bila memungkinkan, hubungkan kanal-kanal tersebut agar stok berkurang otomatis di semua tempat saat ada penjualan.',
    'Kalau belum bisa otomatis, tetapkan jadwal pembaruan manual yang tetap, misalnya setiap pagi dan sore.',
    'Batasi siapa yang boleh mengubah angka stok, supaya jejak perubahannya jelas.',
    'Catat alasan setiap penyesuaian stok, termasuk barang rusak, retur, atau sampel.',
  ] },
  { type: 'h2', text: 'Sediakan Bantalan untuk Barang Cepat Laku' },
  { type: 'p', text: 'Selalu ada jeda antara pesanan masuk dan stok tercatat berkurang, sekecil apa pun. Untuk produk yang perputarannya cepat, sisakan sedikit cadangan yang tidak Anda tampilkan sebagai stok tersedia. Cadangan ini menyelamatkan Anda dari pesanan berbarengan di detik yang sama. Selain itu, tetapkan ambang batas stok menipis untuk tiap produk, dan pastikan sistem atau catatan Anda memberi peringatan saat ambang itu tersentuh. Waktu restok berbeda-beda tergantung pemasok, jadi ambang batasnya juga sebaiknya berbeda per produk, bukan disamakan begitu saja.' },
  { type: 'h2', text: 'Punya Rencana untuk Barang Habis' },
  { type: 'p', text: 'Barang habis tidak selalu berarti kehilangan penjualan, asalkan Anda menanganinya dengan terbuka. Daripada menyembunyikan produknya, tampilkan statusnya apa adanya dan beri pembeli jalan keluar.' },
  { type: 'ul', items: [
    'Sediakan tombol untuk memberi tahu pembeli saat stok kembali tersedia.',
    'Buka opsi pre-order dengan estimasi waktu yang realistis dan disebutkan jelas.',
    'Tawarkan produk pengganti yang paling mirip di halaman yang sama.',
    'Jangan biarkan produk yang sudah lama tidak diproduksi tetap tampil tanpa keterangan.',
  ] },
  { type: 'h2', text: 'Cocokkan Secara Berkala' },
  { type: 'p', text: 'Sedigital apa pun sistem Anda, angka di layar bisa melenceng dari kenyataan di rak. Barang jatuh, salah kirim, atau diambil untuk contoh tanpa dicatat. Karena itu jadwalkan penghitungan fisik secara rutin, dan untuk barang yang paling laku lakukan lebih sering dibanding barang yang lambat bergerak. Selisih kecil yang ditemukan cepat jauh lebih mudah ditelusuri daripada selisih besar yang menumpuk selama setahun.' },
  { type: 'p', text: 'Kalau Anda baru mau mulai membenahi, pilih satu langkah saja bulan ini: rapikan kode produk Anda. Hampir semua perbaikan stok lain akan terasa lebih mudah setelah fondasi penamaan itu beres.' },
];

export default content;
