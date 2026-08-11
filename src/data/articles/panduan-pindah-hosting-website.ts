import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "panduan-pindah-hosting-website",
  title: "Panduan Aman Memindahkan Website ke Hosting Baru",
  excerpt: "Langkah-langkah memindahkan website ke hosting baru tanpa kehilangan data atau membuat website mati, mulai dari persiapan hingga pemeriksaan akhir.",
  category: "Panduan",
  date: "19 Maret 2026",
  isoDate: "2026-03-19",
  readTime: "5 menit",
  image: "/images/blog/panduan-2.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Pindah hosting terdengar seperti pekerjaan berisiko tinggi, dan kekhawatiran itu masuk akal. Website adalah wajah bisnis Anda, sehingga mati beberapa jam saja bisa berarti kehilangan calon pelanggan. Kabar baiknya, perpindahan yang direncanakan dengan urutan yang benar hampir selalu berjalan tanpa gangguan berarti. Berikut alur kerja yang aman untuk diikuti.' },
  { type: 'h2', text: 'Alasan Orang Memindahkan Website' },
  { type: 'p', text: 'Sebelum bicara teknis, ada baiknya memastikan alasannya kuat. Pemicu yang umum antara lain website terasa lambat pada jam sibuk, sering mati tanpa penjelasan, dukungan teknis lambat merespons saat dibutuhkan, biaya perpanjangan naik tanpa peningkatan layanan, atau kapasitas yang sudah tidak memadai lagi seiring bertambahnya pengunjung.' },
  { type: 'p', text: 'Kalau masalahnya ternyata pada website itu sendiri — misalnya gambar terlalu berat atau kode yang boros — pindah server tidak akan menyelesaikan apa pun. Pastikan sumber masalahnya benar-benar ada di hosting.' },
  { type: 'h2', text: 'Persiapan Sebelum Memindahkan' },
  { type: 'p', text: 'Sebagian besar kegagalan perpindahan berakar pada persiapan yang dilewati. Sebelum menyentuh apa pun, siapkan hal-hal ini:' },
  { type: 'ul', items: [
    'Cadangan lengkap seluruh berkas dan basis data, disimpan di tempat terpisah dari kedua hosting.',
    'Daftar isi website: alamat email yang menempel di domain, jadwal tugas otomatis, dan layanan lain yang terhubung.',
    'Catatan pengaturan pengarahan domain saat ini, disalin apa adanya sebagai rujukan.',
    'Akses penuh ke akun domain, bukan hanya akun hosting, karena keduanya bisa berada di tempat berbeda.',
    'Waktu pelaksanaan yang dipilih saat kunjungan paling sepi, bukan menjelang kampanye promosi.',
  ] },
  { type: 'h2', text: 'Urutan Perpindahan agar Tidak Ada Waktu Mati' },
  { type: 'p', text: 'Rahasianya sederhana: jangan matikan yang lama sebelum yang baru terbukti bekerja. Salin seluruh berkas dan basis data ke hosting baru terlebih dahulu, lalu jalankan dan uji website di sana melalui alamat sementara. Selama proses ini, pengunjung Anda masih dilayani hosting lama tanpa merasakan apa-apa.' },
  { type: 'p', text: 'Setelah versi di hosting baru terbukti berjalan normal, barulah pengarahan domain dipindahkan. Perubahan ini tidak berlaku serentak di seluruh dunia — sebagian pengunjung masih diarahkan ke lokasi lama selama beberapa waktu. Karena itu, biarkan hosting lama tetap menyala hingga masa peralihannya benar-benar selesai.' },
  { type: 'p', text: 'Hindari juga melakukan pembaruan konten di hosting lama saat masa peralihan berlangsung, karena perubahan itu tidak akan ikut pindah dan berisiko hilang. Bila website Anda menerima pesanan setiap hari, umumkan jendela peralihan kepada tim internal supaya tidak ada transaksi yang tercatat di tempat yang salah.' },
  { type: 'p', text: 'Satu hal yang sering terlupakan: email yang memakai nama domain Anda ikut terpengaruh oleh perubahan pengarahan domain. Kalau layanan email berada di penyedia berbeda, pastikan pengaturannya disalin dengan benar sebelum peralihan, agar pesan masuk tidak tiba-tiba berhenti sampai.' },
  { type: 'h2', text: 'Pemeriksaan Wajib Setelah Pindah' },
  { type: 'ul', items: [
    'Buka beberapa halaman utama dan pastikan gambar serta tampilan muncul lengkap.',
    'Kirim pesan lewat formulir kontak dan pastikan benar-benar sampai ke kotak masuk.',
    'Cek email yang memakai nama domain Anda, baik untuk mengirim maupun menerima.',
    'Pastikan alamat website sudah berawalan https tanpa peringatan keamanan.',
    'Uji proses pemesanan atau pembayaran bila website Anda melayani transaksi.',
    'Periksa alat pengukur kunjungan agar data tetap tercatat setelah perpindahan.',
  ] },
  { type: 'p', text: 'Simpan cadangan terakhir dari hosting lama sebelum akunnya benar-benar ditutup, dan tunggu beberapa waktu setelah semuanya stabil. Bila Anda ragu menjalankan proses ini sendiri, PT Karya Cipta Solusi membuka konsultasi gratis untuk membantu Anda menakar risiko dan menyusun urutan langkahnya.' },
];

export default content;
