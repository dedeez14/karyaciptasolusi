import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "pentingnya-backup-website",
  title: "Backup Website: Asuransi Murah yang Menyelamatkan Bisnis",
  excerpt: "Backup adalah asuransi termurah untuk website bisnis. Pelajari apa yang perlu dicadangkan, seberapa sering, dan kenapa backup yang tidak pernah diuji itu berisiko.",
  category: "Keamanan",
  date: "29 Juni 2026",
  isoDate: "2026-06-29",
  readTime: "5 menit",
  image: "/images/blog/keamanan-3.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Backup terdengar membosankan sampai tiba hari ketika Anda benar-benar membutuhkannya. Isi website bisa lenyap bukan hanya karena serangan. Salah klik saat memperbarui komponen, tagihan hosting yang terlewat, atau kekeliruan anggota tim saat mengedit halaman sudah cukup untuk menghapus pekerjaan berbulan-bulan. Artikel ini membahas apa saja yang perlu dicadangkan, seberapa sering, dan mengapa backup yang tidak pernah diuji sebaiknya belum Anda anggap ada.' },
  { type: 'h2', text: 'Penyebab Kehilangan Data Jarang Sedramatis Dugaan Kita' },
  { type: 'ul', items: [
    'Kesalahan manusia: halaman terhapus, konten tertimpa, atau pengaturan diubah tanpa catatan.',
    'Pembaruan yang gagal di tengah jalan sehingga website tidak bisa dibuka.',
    'Masalah di sisi server atau penyedia hosting.',
    'Layanan yang lupa diperpanjang sehingga data ikut dihapus setelah masa tenggang habis.',
    'Perangkat pribadi yang rusak atau hilang, padahal file sumber desain hanya ada di sana.',
    'Serangan atau penyusupan yang membuat isi website berubah.',
  ] },
  { type: 'h2', text: 'Dua Bagian yang Harus Ikut Dicadangkan' },
  { type: 'p', text: 'Sebuah website umumnya terdiri dari dua bagian. Pertama, file: gambar, dokumen, tema, dan kode program. Kedua, database: buku catatan tempat artikel, daftar produk, pesanan, dan data pengguna disimpan. Banyak orang mengira sudah punya backup padahal yang tersalin hanya salah satunya. Akibatnya, saat pemulihan, tampilan website kembali tetapi seluruh isinya kosong, atau sebaliknya. Pastikan skema backup Anda mencakup keduanya sekaligus, dan idealnya diambil pada waktu yang sama agar cocok satu sama lain.' },
  { type: 'h2', text: 'Aturan 3-2-1 dalam Bahasa Sederhana' },
  { type: 'ul', items: [
    'Tiga salinan data: satu yang aktif dipakai dan dua sebagai cadangan.',
    'Dua jenis penyimpanan berbeda, misalnya penyimpanan awan dan hard disk kantor.',
    'Satu salinan disimpan terpisah dari server website Anda.',
  ] },
  { type: 'p', text: 'Poin terakhir sering diabaikan. Menyimpan seluruh backup di server yang sama dengan website ibarat menaruh kunci cadangan di dalam rumah yang terkunci. Saat servernya bermasalah, backup Anda ikut tidak bisa diakses.' },
  { type: 'h2', text: 'Seberapa Sering dan Berapa Lama Disimpan' },
  { type: 'p', text: 'Frekuensi backup sebaiknya mengikuti seberapa sering isi website berubah. Toko online yang menerima pesanan setiap hari perlu backup harian, karena kehilangan satu hari berarti kehilangan pesanan pelanggan yang nyata. Website profil perusahaan yang jarang diperbarui bisa cukup mingguan. Selain frekuensi, perhatikan berapa banyak versi yang Anda simpan. Masalah kadang baru ketahuan beberapa hari setelah terjadi, jadi memiliki beberapa versi ke belakang memberi Anda ruang untuk memilih titik pemulihan yang benar-benar bersih.' },
  { type: 'h2', text: 'Backup yang Tidak Pernah Diuji Belum Tentu Berfungsi' },
  { type: 'p', text: 'Inilah bagian yang paling sering dilewatkan. File backup bisa saja rusak, tidak lengkap, atau ternyata berhenti berjalan berbulan-bulan lalu tanpa ada yang menyadari. Sekali dalam beberapa bulan, coba pulihkan backup Anda ke lingkungan salinan atau website uji coba, lalu periksa apakah semuanya kembali utuh. Catat juga langkah-langkahnya secara tertulis dan pastikan lebih dari satu orang tahu di mana backup disimpan dan bagaimana cara mengaksesnya. Prosedur pemulihan yang hanya ada di kepala satu orang adalah risiko tersendiri.' },
  { type: 'p', text: 'Dibandingkan kerugian yang dicegahnya, backup adalah salah satu investasi keamanan paling murah yang bisa dilakukan sebuah bisnis. Bila Anda belum yakin website Anda tercadangkan dengan benar, konsultasi gratis bersama PT Karya Cipta Solusi bisa menjadi titik awal untuk memetakannya.' },
];

export default content;
