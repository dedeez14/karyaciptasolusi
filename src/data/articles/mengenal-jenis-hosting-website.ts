import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "mengenal-jenis-hosting-website",
  title: "Mengenal Hosting: Shared, VPS, dan Cloud — Apa Bedanya?",
  excerpt: "Penjelasan sederhana tentang tiga jenis hosting yang paling umum, kelebihan dan batasannya, serta cara memilih yang sesuai kondisi bisnis Anda saat ini.",
  category: "Panduan",
  date: "25 Juli 2026",
  isoDate: "2026-07-25",
  readTime: "6 menit",
  image: "/images/blog/panduan-2.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Saat menyiapkan website, Anda akan disodori pilihan hosting dengan nama-nama yang terdengar mirip: shared, VPS, cloud, dedicated. Halaman penawarannya penuh angka dan singkatan yang tidak berarti apa-apa bagi orang non-teknis. Padahal salah pilih di tahap ini bisa berujung website lambat atau biaya yang lebih besar dari kebutuhan. Mari kita bedah perbedaannya dengan bahasa sehari-hari.' },
  { type: 'h2', text: 'Yang Sebenarnya Anda Sewa Ketika Membeli Hosting' },
  { type: 'p', text: 'Semua file website Anda — teks, gambar, kode program — harus disimpan di komputer yang menyala 24 jam dan terhubung ke internet. Komputer itu disebut server. Hosting adalah layanan menyewa ruang dan tenaga di server tersebut. Yang membedakan jenis hosting bukan fungsinya, melainkan seberapa banyak sumber daya server yang menjadi jatah Anda dan seberapa terpisah jatah itu dari pengguna lain.' },
  { type: 'h2', text: 'Shared Hosting: Berbagi Satu Server Bersama Banyak Orang' },
  { type: 'p', text: 'Anggap ini seperti kamar kos. Satu bangunan dihuni banyak orang, dan fasilitas seperti listrik serta air dipakai bersama. Semua perawatan gedung diurus pemilik kos, jadi Anda tinggal pakai. Inilah pilihan paling terjangkau dan paling mudah, karena Anda tidak perlu tahu apa-apa soal mengelola server.' },
  { type: 'p', text: 'Konsekuensinya, jika ada penghuni lain yang memakai sumber daya secara berlebihan, website Anda ikut terasa lambat. Kemampuan menampung lonjakan pengunjung juga terbatas. Untuk website company profile atau blog yang trafiknya masih wajar, keterbatasan ini biasanya belum terasa mengganggu.' },
  { type: 'h2', text: 'VPS: Ruang Sendiri dengan Jatah yang Terjamin' },
  { type: 'p', text: 'VPS atau Virtual Private Server ibarat menyewa satu unit apartemen di dalam gedung. Gedungnya tetap dipakai bersama, tapi unit Anda punya batas dinding yang jelas dan jatah sumber daya yang tidak bisa dicaplok tetangga. Anda juga bebas mengatur isi unit sesuai kebutuhan.' },
  { type: 'p', text: 'Kebebasan itu datang bersama tanggung jawab. VPS umumnya perlu dikelola sendiri atau oleh tim teknis: memasang pembaruan, mengatur keamanan, memantau kondisi server. Beberapa penyedia menawarkan versi terkelola supaya Anda tidak menangani sisi teknisnya sendiri.' },
  { type: 'h2', text: 'Cloud Hosting: Kapasitas yang Bisa Naik dan Turun' },
  { type: 'p', text: 'Pada cloud hosting, website Anda tidak bergantung pada satu mesin fisik saja, melainkan pada sekumpulan server yang saling menopang. Jika satu mesin bermasalah, beban dialihkan ke mesin lain. Kapasitasnya juga bisa dinaikkan saat trafik melonjak lalu diturunkan lagi saat sepi.' },
  { type: 'p', text: 'Model ini cocok untuk website yang trafiknya tidak bisa ditebak — toko online saat kampanye promosi, portal berita, atau aplikasi yang dipakai banyak orang bersamaan. Perlu diingat, tagihannya sering mengikuti pemakaian, sehingga butuh pemantauan agar biayanya tetap terkendali.' },
  { type: 'h2', text: 'Cara Memilih Tanpa Bingung' },
  { type: 'p', text: 'Alih-alih membandingkan spesifikasi baris per baris, jawab dulu beberapa pertanyaan berikut:' },
  { type: 'ul', items: [
    'Seberapa besar dampaknya bagi bisnis jika website mati selama beberapa jam?',
    'Apakah trafik Anda relatif stabil, atau melonjak tajam pada momen tertentu?',
    'Apakah website hanya menampilkan informasi, atau memproses transaksi dan data pelanggan?',
    'Ada tidaknya orang atau mitra yang siap mengurus sisi teknis server?',
    'Apakah Anda memerlukan pengaturan khusus yang tidak tersedia pada paket standar?',
  ] },
  { type: 'p', text: 'Kalau jawabannya masih sederhana, mulailah dari yang paling ringan. Hosting bukan keputusan seumur hidup — website bisa dipindahkan seiring pertumbuhan bisnis, dan naik kelas saat memang dibutuhkan jauh lebih hemat daripada membayar kapasitas menganggur sejak awal.' },
  { type: 'p', text: 'Jika Anda masih ragu menakar kebutuhan, PT Karya Cipta Solusi menyediakan konsultasi gratis untuk membantu memetakan pilihan yang masuk akal bagi skala bisnis Anda.' },
];

export default content;
