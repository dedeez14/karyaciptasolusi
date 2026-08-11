import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "sistem-inventori-untuk-bisnis",
  title: "Sistem Inventori: Saatnya Mengakhiri Pencatatan Stok Manual",
  excerpt: "Selisih stok dan barang kosong mendadak biasanya berakar pada pencatatan manual. Kenali cara kerja sistem inventori dan langkah pertama menerapkannya.",
  category: "Aplikasi",
  date: "1 Juni 2026",
  isoDate: "2026-06-01",
  readTime: "5 menit",
  image: "/images/blog/aplikasi-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Ada satu kejadian yang dialami hampir semua bisnis yang menyimpan barang: pelanggan memesan, catatan bilang stok masih ada, tetapi rak ternyata kosong. Kejadian sebaliknya juga menyakitkan, yaitu barang menumpuk di gudang tanpa pernah dipesan karena tidak ada yang tahu jumlahnya masih banyak. Keduanya berakar pada masalah yang sama: catatan stok tidak mencerminkan kenyataan.' },
  { type: 'h2', text: 'Kenapa Pencatatan Stok Manual Selalu Meleset' },
  { type: 'p', text: 'Bukan karena orangnya ceroboh. Pencatatan manual meleset karena strukturnya memang rapuh. Barang keluar duluan, pencatatannya menyusul nanti. Barang retur masuk lagi tanpa dicatat. Satu barang ditulis dengan dua nama berbeda oleh dua orang berbeda. Barang dipakai sendiri untuk sampel dan tidak pernah tercatat keluar.' },
  { type: 'p', text: 'Setiap jeda antara kejadian fisik dan pencatatannya adalah celah untuk selisih. Sistem inventori bekerja dengan menutup jeda itu: pencatatan terjadi pada saat barang bergerak, bukan setelahnya.' },
  { type: 'p', text: 'Selisih kecil pun tidak berhenti kecil. Ia menular ke keputusan pembelian, membuat Anda memesan barang yang sebenarnya masih menumpuk, dan menunda pemesanan barang yang justru sudah menipis. Modal pun tertahan di rak dalam bentuk barang yang lambat terjual.' },
  { type: 'h2', text: 'Yang Dilakukan Sistem Inventori' },
  { type: 'p', text: 'Inti sistem inventori adalah mencatat setiap pergerakan barang, bukan sekadar menyimpan angka sisa. Dari catatan pergerakan itu, jumlah sisa dihitung sendiri oleh sistem. Fitur yang biasanya menjadi inti:' },
  { type: 'ul', items: [
    'Riwayat mutasi: setiap barang punya catatan masuk, keluar, retur, dan penyesuaian, lengkap dengan waktu dan pelakunya.',
    'Batas stok minimum: sistem memberi tanda sebelum barang habis, bukan setelahnya.',
    'Banyak lokasi: stok di toko, gudang, dan cabang dihitung terpisah namun bisa dilihat totalnya.',
    'Konversi satuan: pembelian per dus namun penjualan per pieces tetap terhitung benar.',
    'Stock opname terstruktur: hitung fisik dicatat sebagai penyesuaian yang tercatat alasannya, bukan menimpa angka begitu saja.',
  ] },
  { type: 'h2', text: 'Bagian yang Paling Sering Diremehkan: Data Awal' },
  { type: 'p', text: 'Sistem sebagus apa pun akan salah jika titik awalnya salah. Sebelum sistem menyala, dua pekerjaan wajib diselesaikan. Pertama, rapikan penamaan barang dan beri kode yang unik untuk setiap varian, termasuk perbedaan ukuran atau warna. Kedua, lakukan hitung fisik menyeluruh untuk menetapkan saldo awal.' },
  { type: 'p', text: 'Pekerjaan ini melelahkan dan sering ingin dilewati. Padahal justru di sinilah sebagian besar kegagalan penerapan bermula. Angka awal yang salah akan terus terbawa dan membuat tim kehilangan kepercayaan pada sistem dalam hitungan minggu.' },
  { type: 'h2', text: 'Mengukur Apakah Sistemnya Berhasil' },
  { type: 'p', text: 'Keberhasilan sistem inventori tidak diukur dari banyaknya fitur, melainkan dari berkurangnya selisih. Cara paling sederhana: lakukan hitung acak beberapa jenis barang secara berkala, lalu bandingkan dengan angka di sistem. Jika selisihnya mengecil dari bulan ke bulan, sistem dan kebiasaan tim sudah berjalan seiring.' },
  { type: 'p', text: 'Perhatikan juga tanda yang lebih halus. Jika pertanyaan seperti barang ini masih ada berapa mulai dijawab dengan melihat layar, bukan dengan berjalan ke gudang, artinya kepercayaan pada data sudah terbentuk. Di titik itulah sistem inventori mulai benar-benar menghemat waktu Anda.' },
  { type: 'p', text: 'Jika Anda ingin memulai, ambil satu kategori barang yang paling cepat perputarannya sebagai percobaan. Menerapkan sistem pada lingkup kecil dulu jauh lebih mudah dievaluasi daripada langsung memindahkan seluruh gudang sekaligus.' },
];

export default content;
