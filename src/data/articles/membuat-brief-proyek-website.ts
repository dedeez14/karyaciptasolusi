import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "membuat-brief-proyek-website",
  title: "Cara Membuat Brief Proyek Website agar Hasil Sesuai Harapan",
  excerpt: "Brief yang jelas membuat penawaran lebih akurat dan revisi lebih sedikit. Ini isi brief yang perlu ditulis, plus contoh kalimat kabur dan perbaikannya.",
  category: "Tips",
  date: "8 Mei 2026",
  isoDate: "2026-05-08",
  readTime: "5 menit",
  image: "/images/blog/tips-2.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Banyak proyek website berakhir mengecewakan bukan karena developernya buruk, melainkan karena kedua pihak membayangkan hal yang berbeda sejak awal. Brief adalah dokumen pendek berisi penjelasan kebutuhan Anda, dan biasanya cukup satu sampai tiga halaman. Menulisnya memakan waktu satu sore, tapi menghemat berminggu-minggu revisi. Berikut isi dan cara menulisnya.' },
  { type: 'h2', text: 'Tulis Kabur, Dapat Hasil Kabur' },
  { type: 'p', text: 'Perbedaan brief yang baik dan buruk terletak pada seberapa mudah kalimatnya dibayangkan orang lain. Contoh permintaan kabur: "Websitenya harus modern, menarik, dan profesional." Tiga kata itu berarti berbeda bagi setiap orang, jadi hasilnya nyaris pasti meleset.' },
  { type: 'p', text: 'Versi yang bisa dikerjakan: "Warna dominan putih dengan aksen hijau sesuai logo. Foto produk ditampilkan besar di halaman depan. Tidak ada animasi bergerak karena pembeli kami banyak yang berusia di atas lima puluh tahun. Menu utama maksimal lima item."' },
  { type: 'p', text: 'Contoh lain. Kabur: "Ada fitur pemesanan." Jelas: "Pengunjung memilih produk, mengisi nama, alamat, dan nomor telepon, lalu pesanannya masuk ke WhatsApp kami dalam bentuk teks yang sudah tersusun. Pembayaran dilakukan manual lewat transfer, tanpa integrasi payment gateway."' },
  { type: 'h2', text: 'Delapan Bagian Isi Brief' },
  { type: 'ul', items: [
    'Tentang bisnis: apa yang Anda jual, kepada siapa, dan apa yang membedakan',
    'Tujuan website: satu kalimat tentang apa yang dianggap berhasil, misalnya menerima permintaan penawaran lewat WhatsApp',
    'Siapa pengunjungnya: usia, lokasi, dan apakah mayoritas membuka lewat ponsel',
    'Daftar halaman yang dibutuhkan beserta isi singkat tiap halaman',
    'Daftar fitur, dipisah antara yang wajib ada dan yang boleh menyusul',
    'Selera visual: warna, contoh dua atau tiga website yang Anda sukai beserta alasannya, dan hal yang Anda hindari',
    'Kondisi sekarang: apakah domain, hosting, logo, dan foto sudah tersedia atau belum',
    'Waktu dan anggaran: kapan ditargetkan tayang dan berapa rentang biaya yang Anda siapkan',
  ] },
  { type: 'h2', text: 'Sebutkan Anggaran, Jangan Disembunyikan' },
  { type: 'p', text: 'Banyak pemilik bisnis menahan informasi anggaran karena khawatir harga akan menyesuaikan ke atas. Akibatnya justru sebaliknya: vendor menebak, dan Anda menerima penawaran yang tidak relevan. Menyebutkan rentang anggaran membuat vendor bisa menyusun cakupan yang realistis, atau jujur mengatakan bahwa kebutuhan Anda perlu dipecah menjadi beberapa tahap.' },
  { type: 'h2', text: 'Yang Tidak Perlu Anda Tentukan' },
  { type: 'p', text: 'Brief menjelaskan masalah dan hasil yang diinginkan, bukan cara mengerjakannya. Anda tidak perlu menentukan bahasa pemrograman, jenis basis data, atau struktur folder. Serahkan pilihan teknis kepada pihak yang akan mengerjakannya, lalu minta mereka menjelaskan alasannya dalam bahasa yang Anda mengerti.' },
  { type: 'h2', text: 'Pakai Brief yang Sama untuk Semua Vendor' },
  { type: 'p', text: 'Brief tidak harus rapi secara tata bahasa dan tidak perlu dicetak dengan sampul. Dokumen sederhana berisi poin-poin sudah jauh lebih baik daripada penjelasan lisan yang berpindah-pindah lewat telepon dan pesan singkat. Yang penting semua pihak membaca teks yang sama.' },
  { type: 'p', text: 'Kirim dokumen yang persis sama ke setiap vendor yang Anda pertimbangkan. Dengan begitu perbedaan penawaran benar-benar mencerminkan cara kerja mereka, bukan perbedaan informasi yang mereka terima. Perhatikan juga siapa yang mengajukan pertanyaan balik paling tajam, karena itu tanda mereka benar-benar membaca dan berpikir.' },
  { type: 'p', text: 'Simpan brief sebagai dokumen hidup: setiap kesepakatan baru selama proyek berjalan dicatat di sana, lengkap dengan tanggalnya. Kalau Anda ingin brief Anda ditinjau lebih dulu sebelum dikirim ke mana-mana, tim PT Karya Cipta Solusi siap membahasnya dalam sesi konsultasi gratis.' },
];

export default content;
