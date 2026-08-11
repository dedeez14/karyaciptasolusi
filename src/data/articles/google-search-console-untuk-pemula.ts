import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "google-search-console-untuk-pemula",
  title: "Mengenal Google Search Console dan Cara Membaca Datanya",
  excerpt: "Search Console adalah alat gratis dari Google yang menunjukkan bagaimana website Anda tampil di hasil pencarian. Begini cara memasang dan membaca datanya.",
  category: "SEO",
  date: "2 April 2026",
  isoDate: "2026-04-02",
  readTime: "6 menit",
  image: "/images/blog/seo-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Sebagian besar keputusan SEO yang buruk lahir dari menebak-nebak. Orang menebak kata kunci apa yang membawa pengunjung, menebak halaman mana yang bekerja, dan menebak apakah usahanya membuahkan hasil. Padahal Google sendiri menyediakan alat gratis yang menjawab hampir semua tebakan itu: Google Search Console. Artikel ini membantu Anda memasangnya dan memahami angka-angkanya tanpa perlu latar belakang teknis.' },
  { type: 'h2', text: 'Apa Bedanya dengan Google Analytics' },
  { type: 'p', text: 'Dua alat ini sering tertukar. Analytics menceritakan apa yang terjadi setelah orang masuk ke website Anda — halaman yang dibuka, berapa lama bertahan, dan seterusnya. Search Console menceritakan apa yang terjadi sebelum itu: kata kunci apa yang memunculkan website Anda di hasil pencarian, berapa kali muncul, dan berapa yang benar-benar mengklik. Untuk urusan SEO, Search Console adalah alat yang lebih tepat.' },
  { type: 'h2', text: 'Memasangnya: Empat Langkah' },
  { type: 'ul', items: [
    'Masuk ke Search Console memakai akun Google milik bisnis, bukan akun pribadi karyawan yang bisa berganti sewaktu-waktu.',
    'Tambahkan properti website Anda, lalu buktikan kepemilikannya — bisa lewat pengaturan domain, berkas yang diunggah, atau potongan kode di website.',
    'Kirimkan sitemap agar Google punya daftar lengkap halaman Anda sejak awal.',
    'Tunggu beberapa hari. Laporannya tidak langsung terisi penuh, dan itu normal.',
  ] },
  { type: 'h2', text: 'Empat Angka di Laporan Performa' },
  { type: 'p', text: 'Laporan performa adalah bagian yang paling sering dibuka, dan isinya empat angka utama.' },
  { type: 'ul', items: [
    'Impresi: berapa kali halaman Anda tampil di hasil pencarian, terlepas dari diklik atau tidak.',
    'Klik: berapa kali orang benar-benar mengklik dan masuk ke website Anda.',
    'CTR: perbandingan klik terhadap impresi. Kalau angkanya rendah padahal impresi tinggi, biasanya judul dan deskripsi kurang menarik untuk diklik.',
    'Posisi rata-rata: urutan rata-rata kemunculan halaman Anda. Karena bentuknya rata-rata, wajar bila naik turun sedikit dari waktu ke waktu.',
  ] },
  { type: 'p', text: 'Yang paling berguna dari laporan ini bukan angka totalnya, melainkan daftar kueri di bawahnya — istilah nyata yang diketik orang sampai website Anda muncul. Sering kali ada istilah yang tidak pernah Anda pikirkan, dan itu bahan bagus untuk halaman berikutnya.' },
  { type: 'h2', text: 'Laporan Lain yang Layak Dicek Berkala' },
  { type: 'p', text: 'Selain performa, ada beberapa bagian yang sebaiknya Anda lirik sebulan sekali.' },
  { type: 'ul', items: [
    'Laporan pengindeksan halaman: menunjukkan halaman mana yang sudah masuk katalog Google dan mana yang tidak, beserta alasannya.',
    'Sitemap: memastikan berkas daftar halaman Anda masih terbaca dan tidak error.',
    'Pengalaman halaman: memberi gambaran kecepatan dan kenyamanan halaman berdasarkan kunjungan nyata.',
    'Tindakan manual: bagian yang sebaiknya selalu kosong. Jika terisi, artinya ada pelanggaran pedoman yang perlu segera dibereskan.',
  ] },
  { type: 'h2', text: 'Mengubah Data Jadi Tindakan' },
  { type: 'p', text: 'Data hanya berguna kalau berujung keputusan. Beberapa pola yang paling sering muncul dan tindakannya: halaman dengan impresi tinggi tetapi klik rendah biasanya butuh judul dan deskripsi yang lebih menjawab; kueri yang sudah memunculkan website Anda tetapi belum punya halaman khusus adalah kesempatan membuat halaman baru; halaman penting yang ternyata belum terindeks berarti ada masalah teknis yang perlu ditelusuri lebih dulu.' },
  { type: 'p', text: 'Kalau Anda sudah memasang Search Console tetapi bingung menerjemahkan laporannya menjadi rencana kerja, PT Karya Cipta Solusi bisa membantu membacakannya bersama Anda dalam sesi konsultasi gratis.' },
];

export default content;
