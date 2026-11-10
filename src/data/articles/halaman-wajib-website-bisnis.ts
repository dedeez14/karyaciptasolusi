import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "halaman-wajib-website-bisnis",
  title: "Halaman dan Konten yang Wajib Ada di Website Bisnis",
  excerpt: "Banyak website bisnis terlihat rapi tapi tidak menjawab pertanyaan calon pembeli. Ini halaman inti yang wajib ada beserta isi minimal tiap halaman.",
  category: "Tips",
  date: "27 Juli 2026",
  isoDate: "2026-07-27",
  readTime: "6 menit",
  image: "/images/blog/tips-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Pertanyaan yang hampir selalu muncul di awal proyek: sebenarnya berapa halaman yang saya butuhkan? Jawabannya bukan sebanyak-banyaknya, melainkan secukupnya — asalkan setiap halaman menjawab pertanyaan yang memang ada di kepala calon pembeli. Berikut halaman inti untuk website bisnis, lengkap dengan isi minimal yang perlu Anda siapkan sebelum menghubungi developer.' },
  { type: 'h2', text: 'Beranda: Jawab Tiga Pertanyaan dalam Lima Detik' },
  { type: 'p', text: 'Pengunjung baru membuka beranda dengan tiga pertanyaan: Anda ini siapa, masalah apa yang bisa Anda selesaikan, dan apa yang harus saya lakukan sekarang. Kalau bagian paling atas beranda tidak menjawabnya, pengunjung akan kembali ke hasil pencarian dan membuka website lain.' },
  { type: 'p', text: 'Contoh judul beranda yang lemah: "Selamat Datang di Website Resmi Kami". Kalimat itu tidak memberi informasi apa pun. Versi yang lebih kuat: "Servis AC Panggilan di Depok, Teknisi Datang di Hari yang Sama". Pembaca langsung tahu layanannya, wilayahnya, dan alasan untuk lanjut membaca.' },
  { type: 'ul', items: [
    'Judul utama yang menyebut layanan dan wilayah operasi',
    'Satu kalimat pendukung berisi keunggulan yang konkret, bukan kata sifat',
    'Satu tombol aksi utama, misalnya Chat WhatsApp atau Minta Penawaran',
    'Ringkasan layanan dengan tautan ke halaman masing-masing',
    'Bukti kepercayaan: foto hasil kerja, testimoni singkat, atau logo klien',
  ] },
  { type: 'h2', text: 'Halaman Layanan: Satu Halaman untuk Satu Layanan Utama' },
  { type: 'p', text: 'Menumpuk semua layanan dalam satu halaman panjang membuat pembaca sulit menemukan yang ia cari, sekaligus membuat mesin pencari bingung menentukan halaman mana yang paling relevan untuk satu pencarian. Kalau Anda punya tiga layanan utama, buat tiga halaman terpisah dengan isi yang tidak saling menyalin.' },
  { type: 'ul', items: [
    'Masalah yang diselesaikan layanan ini, ditulis dengan bahasa pelanggan',
    'Apa saja yang termasuk dan apa yang tidak termasuk',
    'Tahapan pengerjaan dari awal sampai selesai',
    'Perkiraan durasi dan area yang dilayani',
    'Harga, atau minimal faktor apa saja yang membuat harga naik-turun',
    'Tiga sampai lima pertanyaan yang paling sering ditanyakan',
    'Tombol aksi di akhir halaman, bukan hanya di atas',
  ] },
  { type: 'h2', text: 'Tentang Kami: Bukti Ada Manusia di Balik Layar' },
  { type: 'p', text: 'Halaman ini bukan tempat menulis sejarah panjang perusahaan. Isi minimalnya sederhana: siapa yang menjalankan bisnis, sejak kapan, di mana lokasinya, dan mengapa pembaca bisa menitipkan pekerjaannya kepada Anda. Foto asli tim atau tempat usaha jauh lebih meyakinkan daripada ilustrasi generik yang bisa dipakai siapa saja.' },
  { type: 'h2', text: 'Kontak: Mudah Ditemukan dan Benar-Benar Dijawab' },
  { type: 'p', text: 'Halaman kontak adalah tempat calon pelanggan mengambil keputusan terakhir. Jangan sampai ia sudah yakin, lalu batal hanya karena nomor telepon harus disalin manual.' },
  { type: 'ul', items: [
    'Nomor WhatsApp dalam bentuk tautan agar sekali ketuk langsung membuka ruang chat',
    'Alamat email yang memakai nama domain sendiri, bukan alamat gratisan',
    'Alamat lengkap dan peta lokasi jika Anda menerima kunjungan',
    'Jam operasional dan perkiraan berapa lama pesan biasanya dibalas',
    'Formulir singkat, maksimal empat kolom isian',
  ] },
  { type: 'p', text: 'Uji formulir Anda sendiri setiap beberapa bulan dengan mengirim pesan percobaan. Formulir rusak yang dibiarkan berbulan-bulan adalah kebocoran calon pelanggan yang paling sering tidak disadari pemilik website.' },
  { type: 'h2', text: 'Halaman Pendukung yang Ditambahkan Sesuai Kebutuhan' },
  { type: 'ul', items: [
    'FAQ untuk menampung pertanyaan yang sama berulang kali di WhatsApp',
    'Portofolio atau galeri hasil kerja dengan keterangan singkat tiap proyek',
    'Halaman testimoni beserta nama dan asal pelanggan, bila mereka mengizinkan',
    'Blog untuk menjawab pertanyaan calon pelanggan sebelum mereka menghubungi Anda',
    'Kebijakan privasi dan syarat ketentuan, penting bila Anda mengumpulkan data lewat formulir atau menerima pembayaran',
    'Halaman 404 yang mengarahkan pengunjung kembali ke beranda atau daftar layanan',
  ] },
  { type: 'p', text: 'Kalau Anda harus memilih urutan pengerjaan, mulailah dari halaman layanan dan halaman kontak. Dua halaman itulah yang paling sering menentukan apakah pengunjung menghubungi Anda atau menutup tab. Sisanya bisa menyusul setelah versi pertama website Anda hidup dan mulai dikunjungi.' },
];

export default content;
