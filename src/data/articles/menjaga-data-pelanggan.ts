import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "menjaga-data-pelanggan",
  title: "Menjaga Data Pelanggan: Kewajiban Setiap Pemilik Website",
  excerpt: "Data pelanggan adalah titipan, bukan aset bebas pakai. Ini langkah praktis menyimpan, membatasi akses, dan menghapus data agar kepercayaan tetap terjaga.",
  category: "Keamanan",
  date: "28 Mei 2026",
  isoDate: "2026-05-28",
  readTime: "5 menit",
  image: "/images/blog/keamanan-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Setiap kali seseorang mengisi formulir kontak, mendaftar newsletter, atau berbelanja di website Anda, mereka menitipkan sesuatu yang bernilai: data pribadi mereka. Nama, nomor telepon, alamat, riwayat pesanan. Menjaganya bukan semata urusan teknis, melainkan bagian dari cara Anda memperlakukan pelanggan. Artikel ini merangkum langkah praktis yang bisa diterapkan bahkan oleh bisnis dengan tim yang sangat kecil.' },
  { type: 'h2', text: 'Kumpulkan Seperlunya, Simpan Sesingkatnya' },
  { type: 'p', text: 'Aturan paling efektif sekaligus paling sering dilewatkan: data yang tidak Anda kumpulkan tidak mungkin bocor. Coba buka kembali formulir di website Anda. Apakah tanggal lahir benar-benar dibutuhkan hanya untuk menjawab pertanyaan calon pelanggan? Apakah alamat lengkap diperlukan bila produk Anda berbentuk digital? Setiap kolom tambahan menambah tanggung jawab yang harus Anda pikul selamanya. Prinsip yang sama berlaku untuk lama penyimpanan. Data pesanan yang sudah tidak relevan sebaiknya diarsipkan atau dihapus mengikuti kebijakan yang Anda tetapkan sendiri.' },
  { type: 'h2', text: 'Batasi Siapa yang Bisa Melihat' },
  { type: 'ul', items: [
    'Berikan akun terpisah untuk setiap anggota tim. Jangan ada satu akun admin yang dipakai beramai-ramai.',
    'Sesuaikan hak akses dengan pekerjaan. Staf yang mengurus konten tidak perlu melihat data pembayaran.',
    'Cabut akses segera saat seseorang berhenti bekerja atau berpindah peran, bukan nanti kalau sempat.',
    'Tinjau daftar pengguna secara berkala dan hapus akun yang sudah tidak dipakai, termasuk milik vendor lama.',
  ] },
  { type: 'h2', text: 'Amankan Perjalanan dan Tempat Simpannya' },
  { type: 'p', text: 'Data pelanggan perlu dijaga di dua titik. Saat berpindah, yaitu ketika pengunjung mengirim formulir, koneksi HTTPS memastikan isinya tidak terbaca di tengah jalan. Saat tersimpan, database perlu berada di lingkungan yang terlindungi dan hanya bisa diakses oleh sistem yang berhak. Satu hal yang layak Anda tanyakan kepada pengembang: password pelanggan seharusnya tidak pernah tersimpan sebagai teks biasa, melainkan dalam bentuk yang sudah diacak satu arah sehingga tidak bisa dikembalikan. Untuk data kartu pembayaran, cara paling aman adalah tidak menyimpannya sendiri dan menyerahkan prosesnya kepada penyedia pembayaran resmi.' },
  { type: 'h2', text: 'Kebocoran Sering Terjadi di Luar Server' },
  { type: 'p', text: 'Pengalaman di lapangan menunjukkan bahwa data pelanggan lebih sering tersebar karena kebiasaan sehari-hari, bukan karena servernya jebol.' },
  { type: 'ul', items: [
    'Mengekspor daftar pelanggan ke spreadsheet lalu menyimpannya di laptop pribadi tanpa proteksi.',
    'Mengirim data pelanggan lewat grup chat yang anggotanya terus berganti.',
    'Membuka dashboard admin di perangkat bersama dan lupa keluar dari akun.',
    'Memberi akses penuh kepada vendor atau tenaga lepas tanpa batas waktu yang jelas.',
    'Menyimpan tangkapan layar berisi data pelanggan di galeri ponsel yang tersinkronisasi ke mana-mana.',
  ] },
  { type: 'h2', text: 'Transparansi Justru Menguatkan Kepercayaan' },
  { type: 'p', text: 'Kebijakan privasi bukan sekadar tautan formalitas di bagian bawah halaman. Tulis dengan bahasa manusia: data apa yang Anda kumpulkan, untuk keperluan apa, berapa lama disimpan, dan ke mana pelanggan bisa menghubungi Anda bila ingin datanya diperbaiki atau dihapus. Pastikan alamat kontak itu benar-benar dipantau. Bila suatu saat terjadi insiden, memberi tahu lebih awal dengan jujur biasanya jauh lebih baik bagi reputasi Anda daripada berharap tidak ada yang menyadarinya.' },
  { type: 'p', text: 'Anggap data pelanggan sebagai titipan, bukan aset yang bebas dipakai. Mulailah dari langkah paling ringan hari ini: buka kembali formulir website Anda dan hapus satu kolom yang sebenarnya tidak pernah Anda gunakan.' },
];

export default content;
