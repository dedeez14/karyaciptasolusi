export interface BlogBlock {
  type: 'p' | 'h2' | 'ul';
  text?: string;
  items?: string[];
}

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  date: string;
  isoDate: string;
  readTime: string;
  color: string;
  content: BlogBlock[];
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'berapa-biaya-pembuatan-website-2026',
    title: 'Berapa Biaya Pembuatan Website di 2026? Ini Rinciannya',
    excerpt: 'Panduan lengkap memahami komponen biaya pembuatan website — dari domain, hosting, desain, hingga fitur custom — agar Anda tidak membayar lebih dari yang seharusnya.',
    category: 'Panduan',
    date: '15 Juli 2026',
    isoDate: '2026-07-15',
    readTime: '7 menit',
    color: 'from-[#2563EB] to-[#1D4ED8]',
    content: [
      { type: 'p', text: 'Pertanyaan pertama hampir setiap pemilik bisnis sebelum membuat website adalah: berapa biayanya? Jawaban jujurnya — tergantung kebutuhan Anda. Website company profile 5 halaman dan aplikasi toko online dengan payment gateway jelas berbeda jauh biayanya. Artikel ini membedah komponen biayanya satu per satu agar Anda bisa menilai penawaran dengan cerdas.' },
      { type: 'h2', text: 'Komponen Biaya Pembuatan Website' },
      { type: 'ul', items: [
        'Domain: identitas alamat website Anda (contoh: namabisnis.com), umumnya ratusan ribu rupiah per tahun.',
        'Hosting/server: tempat website Anda "tinggal". Biayanya menyesuaikan trafik dan kebutuhan performa.',
        'Desain & pengembangan: porsi terbesar — mencakup desain tampilan, penulisan kode, dan pengujian.',
        'Fitur khusus: toko online, sistem member, integrasi pembayaran, atau dashboard admin menambah lingkup kerja.',
        'Perawatan (maintenance): update keamanan, backup, dan perbaikan berkala setelah website tayang.',
      ] },
      { type: 'h2', text: 'Kenapa Harga Antar Penyedia Jasa Bisa Jauh Berbeda?' },
      { type: 'p', text: 'Dua penawaran dengan judul sama — "pembuatan website company profile" — bisa berbeda harga berkali lipat. Pembedanya biasanya: apakah desain dibuat khusus atau memakai template jadi, apakah website dioptimasi untuk kecepatan dan SEO, siapa yang menulis kontennya, dan apakah ada garansi serta dukungan setelah tayang. Website murah yang lambat dan tidak muncul di Google pada akhirnya lebih mahal, karena tidak menghasilkan apa-apa untuk bisnis Anda.' },
      { type: 'h2', text: 'Tips agar Anggaran Anda Efisien' },
      { type: 'ul', items: [
        'Tentukan tujuan website sejak awal: mencari calon pelanggan, menerima pesanan, atau membangun kredibilitas.',
        'Mulai dari kebutuhan inti dulu — fitur tambahan bisa menyusul setelah website terbukti berjalan.',
        'Minta rincian lingkup kerja tertulis, bukan hanya angka total.',
        'Pastikan ada garansi perbaikan bug dan kejelasan kepemilikan source code.',
        'Pilih skema pembayaran bertahap sehingga Anda melihat progres sebelum melunasi.',
      ] },
      { type: 'h2', text: 'Bagaimana Kami Menentukan Harga' },
      { type: 'p', text: 'Di PT Karya Cipta Solusi, kami tidak memakai paket harga tetap. Setiap penawaran disusun dari hasil konsultasi — Anda menjelaskan kebutuhan, kami petakan solusinya beserta rincian biayanya secara transparan. Pembayaran bertahap (DP 30%, 40% saat demo, sisanya setelah selesai), garansi bug fixing 1 bulan, dan source code menjadi milik Anda setelah pelunasan. Konsultasinya gratis dan tanpa komitmen.' },
    ],
  },
  {
    slug: 'cara-memilih-jasa-pembuatan-website',
    title: '7 Cara Memilih Jasa Pembuatan Website yang Tepat & Terpercaya',
    excerpt: 'Jangan sampai salah pilih vendor. Ini 7 hal yang wajib Anda periksa sebelum menyerahkan proyek website bisnis Anda kepada penyedia jasa.',
    category: 'Tips',
    date: '8 Juli 2026',
    isoDate: '2026-07-08',
    readTime: '6 menit',
    color: 'from-[#0F4C81] to-[#1E6BAF]',
    content: [
      { type: 'p', text: 'Memilih jasa pembuatan website adalah keputusan penting — website adalah wajah bisnis Anda di internet selama bertahun-tahun ke depan. Salah pilih vendor bisa berarti proyek molor, hasil mengecewakan, atau yang terburuk: website jadi tapi tidak bisa diubah karena Anda tidak memegang akses apa pun. Berikut 7 hal yang wajib diperiksa.' },
      { type: 'h2', text: '1. Legalitas yang Jelas' },
      { type: 'p', text: 'Vendor berbadan hukum (PT/CV) memberi perlindungan lebih: ada kontrak resmi, ada entitas yang bertanggung jawab, dan kerja sama Anda punya dasar hukum. Ini bukan berarti freelancer selalu buruk — tapi untuk proyek bisnis yang serius, legalitas mengurangi risiko Anda.' },
      { type: 'h2', text: '2. Portofolio dan Rekam Jejak' },
      { type: 'p', text: 'Lihat proyek yang pernah dikerjakan. Perhatikan apakah jenis proyeknya relevan dengan kebutuhan Anda — vendor yang terbiasa membuat sistem informasi belum tentu cocok untuk toko online, dan sebaliknya.' },
      { type: 'h2', text: '3. Kejelasan Kepemilikan Source Code' },
      { type: 'p', text: 'Tanyakan sejak awal: setelah lunas, apakah source code dan seluruh akses (domain, hosting, admin) diserahkan ke Anda? Vendor yang baik tidak "mengunci" kliennya. Tanpa ini, Anda akan bergantung selamanya pada satu vendor untuk perubahan sekecil apa pun.' },
      { type: 'h2', text: '4. Skema Pembayaran yang Adil' },
      { type: 'p', text: 'Hindari membayar penuh di muka. Skema bertahap — misalnya DP, pembayaran saat demo, dan pelunasan setelah selesai — memastikan kedua pihak sama-sama berkomitmen dan Anda melihat hasil sebelum membayar penuh.' },
      { type: 'h2', text: '5. Garansi Setelah Website Tayang' },
      { type: 'p', text: 'Bug setelah peluncuran itu normal dalam pengembangan software. Yang penting: apakah vendor memberi garansi perbaikan gratis dalam periode tertentu? Pastikan tertulis di kontrak.' },
      { type: 'h2', text: '6. Komunikasi yang Responsif' },
      { type: 'p', text: 'Perhatikan cara vendor merespons sejak konsultasi awal. Jika sebelum membayar saja balasannya lambat, jangan berharap lebih setelah proyek berjalan. Vendor yang baik memberi update progres rutin tanpa harus dikejar.' },
      { type: 'h2', text: '7. Paham Bisnis, Bukan Sekadar Coding' },
      { type: 'p', text: 'Vendor terbaik bertanya tentang tujuan bisnis Anda sebelum bicara teknologi: siapa target pasarnya, apa yang diharapkan dari website, bagaimana mengukur keberhasilannya. Website yang bagus secara teknis tapi tidak menjawab kebutuhan bisnis adalah pemborosan.' },
      { type: 'p', text: 'PT Karya Cipta Solusi memenuhi ketujuh kriteria di atas — badan usaha resmi, pembayaran bertahap, garansi bug fixing 1 bulan, dan source code milik Anda. Konsultasikan kebutuhan Anda secara gratis, kami bantu petakan solusinya.' },
    ],
  },
  {
    slug: 'kenapa-bisnis-butuh-website',
    title: 'Punya Instagram & Marketplace, Kenapa Bisnis Tetap Butuh Website?',
    excerpt: 'Media sosial dan marketplace itu penting — tapi keduanya bukan milik Anda. Ini alasan website tetap menjadi aset digital paling penting untuk bisnis.',
    category: 'Bisnis',
    date: '1 Juli 2026',
    isoDate: '2026-07-01',
    readTime: '5 menit',
    color: 'from-[#1D4ED8] to-[#2563EB]',
    content: [
      { type: 'p', text: '"Bisnis saya sudah ada di Instagram dan marketplace, untuk apa website?" — ini pertanyaan yang sangat wajar. Media sosial memang luar biasa untuk menjangkau pelanggan. Tapi ada perbedaan mendasar yang sering terlewat: akun media sosial dan lapak marketplace bukan milik Anda. Website adalah satu-satunya properti digital yang sepenuhnya Anda kendalikan.' },
      { type: 'h2', text: 'Risiko Bergantung Sepenuhnya pada Platform Lain' },
      { type: 'ul', items: [
        'Akun bisa dibatasi, di-suspend, atau hilang sewaktu-waktu — dan pelanggan Anda ikut hilang bersamanya.',
        'Algoritma berubah tanpa pemberitahuan; jangkauan konten bisa anjlok dalam semalam.',
        'Di marketplace, pesaing Anda tampil persis di sebelah produk Anda, bersaing harga semata.',
        'Data pelanggan dikuasai platform, bukan Anda.',
      ] },
      { type: 'h2', text: 'Apa yang Hanya Bisa Diberikan oleh Website' },
      { type: 'p', text: 'Kredibilitas: calon pelanggan (apalagi korporasi dan instansi) hampir selalu mengecek website sebelum memutuskan bekerja sama — bisnis tanpa website sering dianggap kurang serius. Ditemukan di Google: orang yang mengetik "jasa X di kota Y" di Google sedang siap membeli — dan yang muncul di hasil pencarian adalah website, bukan akun Instagram. Kendali penuh: tampilan, konten, data pelanggan, dan pengalaman pengguna sepenuhnya Anda yang menentukan.' },
      { type: 'h2', text: 'Strategi yang Benar: Kombinasi, Bukan Memilih Salah Satu' },
      { type: 'p', text: 'Media sosial untuk menjangkau dan berinteraksi, website sebagai pusat informasi dan konversi. Semua bio Instagram, TikTok, dan marketplace Anda mengarah ke satu tempat yang Anda kendalikan penuh. Saat platform berubah, bisnis Anda tetap berdiri di fondasinya sendiri.' },
      { type: 'p', text: 'Ingin mulai membangun aset digital milik Anda sendiri? PT Karya Cipta Solusi melayani jasa pembuatan website company profile dan toko online — konsultasinya gratis, harga menyesuaikan kebutuhan.' },
    ],
  },
  {
    slug: 'website-company-profile-vs-toko-online',
    title: 'Website Company Profile vs Toko Online: Mana yang Bisnis Anda Butuhkan?',
    excerpt: 'Keduanya sama-sama "website", tapi tujuan, fitur, dan biayanya berbeda jauh. Kenali perbedaannya sebelum memutuskan.',
    category: 'Panduan',
    date: '24 Juni 2026',
    isoDate: '2026-06-24',
    readTime: '5 menit',
    color: 'from-[#1E6BAF] to-[#0F4C81]',
    content: [
      { type: 'p', text: 'Saat berkonsultasi, banyak calon klien menyebut "mau buat website" — padahal yang dimaksud bisa sangat berbeda: ada yang butuh company profile, ada yang butuh toko online lengkap. Memahami perbedaannya membantu Anda menentukan kebutuhan (dan anggaran) dengan tepat.' },
      { type: 'h2', text: 'Website Company Profile: Membangun Kredibilitas' },
      { type: 'p', text: 'Tujuannya memperkenalkan bisnis Anda secara profesional: siapa Anda, layanan apa yang ditawarkan, portofolio, dan cara menghubungi. Cocok untuk perusahaan jasa, kontraktor, konsultan, klinik, sekolah, dan hampir semua B2B. Fiturnya relatif sederhana — halaman profil, layanan, galeri, form kontak — sehingga waktu pengerjaan lebih singkat dan biaya lebih terjangkau.' },
      { type: 'h2', text: 'Toko Online: Menerima Transaksi Langsung' },
      { type: 'p', text: 'Toko online (e-commerce) memungkinkan pelanggan memilih produk, memasukkan keranjang, membayar, dan melacak pesanan — semua di website Anda. Ini membutuhkan katalog produk, manajemen stok, integrasi payment gateway, perhitungan ongkir, dan dashboard admin. Lingkup kerjanya lebih besar, begitu pula investasinya.' },
      { type: 'h2', text: 'Cara Cepat Menentukan Pilihan' },
      { type: 'ul', items: [
        'Bisnis jasa atau B2B yang transaksinya lewat negosiasi? Company profile sudah tepat.',
        'Menjual produk fisik/digital dengan harga pasti dan ingin menerima pembayaran otomatis? Anda butuh toko online.',
        'Ragu-ragu? Mulai dari company profile dengan katalog produk + tombol pesan via WhatsApp — jalur upgrade ke e-commerce selalu terbuka.',
      ] },
      { type: 'p', text: 'Masih bingung menentukan? Ceritakan model bisnis Anda ke tim PT Karya Cipta Solusi — konsultasi gratis, dan kami rekomendasikan solusi yang paling masuk akal untuk tahap bisnis Anda sekarang, bukan yang paling mahal.' },
    ],
  },
  {
    slug: 'checklist-persiapan-membuat-website',
    title: 'Checklist Persiapan Sebelum Membuat Website Bisnis',
    excerpt: 'Proyek website berjalan jauh lebih cepat dan hasilnya lebih tepat sasaran jika Anda menyiapkan hal-hal ini sebelum development dimulai.',
    category: 'Tips',
    date: '17 Juni 2026',
    isoDate: '2026-06-17',
    readTime: '4 menit',
    color: 'from-[#2563EB] to-[#0F4C81]',
    content: [
      { type: 'p', text: 'Salah satu penyebab proyek website molor bukanlah coding — melainkan menunggu bahan dari klien. Dengan menyiapkan hal-hal berikut sebelum proyek dimulai, website Anda bisa selesai lebih cepat dan hasilnya lebih sesuai harapan.' },
      { type: 'h2', text: '1. Tujuan yang Jelas' },
      { type: 'p', text: 'Satu kalimat saja: "website ini berhasil jika ____". Misalnya: menghasilkan pertanyaan penawaran via WhatsApp, menerima pesanan online, atau membuat bisnis terlihat kredibel saat dicari di Google. Tujuan ini menentukan seluruh desain dan fiturnya.' },
      { type: 'h2', text: '2. Konten Dasar' },
      { type: 'ul', items: [
        'Profil singkat perusahaan dan keunggulannya',
        'Daftar layanan/produk beserta deskripsi singkat',
        'Foto-foto asli (tim, kantor, produk, hasil kerja) — foto asli selalu lebih meyakinkan daripada stok foto',
        'Logo dalam kualitas baik',
        'Kontak: nomor WhatsApp, email, alamat, jam operasional',
      ] },
      { type: 'h2', text: '3. Referensi Website yang Anda Sukai' },
      { type: 'p', text: 'Kumpulkan 2-3 contoh website (dari industri apa pun) yang tampilannya Anda sukai, dan catat bagian mana yang menarik. Ini mempercepat penyamaan visi desain dengan developer.' },
      { type: 'h2', text: '4. Nama Domain' },
      { type: 'p', text: 'Pikirkan nama domain yang singkat, mudah dieja, dan sesuai merek. Vendor Anda bisa membantu mengecek ketersediaan dan mendaftarkannya — pastikan domain terdaftar atas nama Anda, bukan atas nama vendor.' },
      { type: 'h2', text: '5. Penanggung Jawab dari Sisi Anda' },
      { type: 'p', text: 'Tunjuk satu orang yang berwenang memberi keputusan dan feedback. Proyek dengan banyak pemberi keputusan yang tidak sinkron hampir selalu molor.' },
      { type: 'p', text: 'Sudah siap semua? Atau justru masih bingung mulai dari mana? Dua-duanya tidak masalah — konsultasikan gratis dengan tim PT Karya Cipta Solusi, kami bantu susun kebutuhannya bersama Anda.' },
    ],
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}
