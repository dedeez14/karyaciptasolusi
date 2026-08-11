import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "mengatur-ongkir-dan-ekspedisi",
  title: "Mengatur Ongkir dan Integrasi Ekspedisi di Toko Online",
  excerpt: "Memahami cara menghitung ongkos kirim, arti berat volumetrik, dan pilihan menampilkan tarif ekspedisi otomatis agar pembeli tidak kaget saat checkout.",
  category: "Toko Online",
  date: "31 Maret 2026",
  isoDate: "2026-03-31",
  readTime: "5 menit",
  image: "/images/blog/toko-online-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Ongkos kirim terlihat seperti urusan administratif kecil, padahal ia salah satu penentu terbesar apakah pesanan jadi atau batal. Salah mengaturnya bisa membuat Anda rugi diam-diam di setiap paket, atau membuat pembeli mundur karena angkanya terasa tidak masuk akal. Artikel ini membahas cara menata bagian ini supaya adil bagi pembeli dan aman bagi margin Anda.' },
  { type: 'h2', text: 'Tiga Cara Umum Menentukan Ongkir' },
  { type: 'p', text: 'Anda tidak wajib memakai satu pendekatan saja. Banyak toko menggabungkan beberapa cara sesuai jenis produk dan tujuan pengiriman.' },
  { type: 'ul', items: [
    'Tarif nyata dari ekspedisi. Sistem menghitung otomatis berdasarkan berat paket dan alamat tujuan. Paling adil, tapi butuh data berat dan dimensi produk yang akurat.',
    'Tarif tetap. Anda menetapkan satu angka untuk wilayah tertentu. Mudah dipahami pembeli, cocok untuk produk yang beratnya seragam.',
    'Gratis ongkir bersyarat. Ongkir ditanggung toko bila belanja mencapai nilai tertentu. Ini bukan benar-benar gratis, biayanya sudah Anda perhitungkan dalam struktur harga, jadi hitung dulu dengan cermat sebelum menawarkannya.',
    'Ambil di tempat. Sering terlupakan, padahal berguna bagi pembeli yang lokasinya dekat dengan toko atau gudang Anda.',
  ] },
  { type: 'h2', text: 'Berat Volumetrik dan Kenapa Tagihan Bisa Lebih Mahal' },
  { type: 'p', text: 'Banyak penjual baru terkejut karena ongkir yang ditagih ekspedisi lebih besar daripada perkiraan mereka. Penyebabnya biasanya berat volumetrik. Ekspedisi tidak hanya menghitung berat timbangan, tapi juga ruang yang dimakan paket di dalam kendaraan. Bantal atau kotak besar berisi barang ringan tetap memakan tempat, sehingga ditagih menurut dimensinya. Yang dipakai adalah nilai yang lebih besar antara berat asli dan berat volumetrik. Karena itu, ukur panjang, lebar, dan tinggi kemasan siap kirim, bukan ukuran produk telanjang, lalu simpan angkanya di data produk Anda sejak awal.' },
  { type: 'h2', text: 'Integrasi Otomatis atau Hitung Manual' },
  { type: 'p', text: 'Menghubungkan toko dengan layanan ekspedisi memungkinkan tarif muncul langsung di halaman checkout sesuai alamat pembeli. Manfaatnya nyata: tidak ada tawar-menawar ongkir lewat pesan, tidak ada salah hitung, dan pembeli bisa memilih sendiri layanan yang sesuai kebutuhan mereka, apakah yang lebih hemat atau yang lebih cepat. Integrasi ini juga biasanya membawa fitur pelacakan, sehingga nomor resi otomatis tersambung dengan halaman status pesanan. Untuk toko dengan pesanan yang masih sedikit dan produk yang seragam, tarif tetap masih cukup memadai. Begitu variasi produk dan tujuan pengiriman melebar, hitung manual mulai memakan waktu dan rawan salah.' },
  { type: 'h2', text: 'Komunikasikan Sejak Awal' },
  { type: 'p', text: 'Kesalahan yang paling merugikan bukan besarnya ongkir, melainkan munculnya terlalu terlambat. Pembeli yang sudah memilih barang lalu baru melihat total biaya di langkah akhir cenderung merasa dijebak.' },
  { type: 'ul', items: [
    'Sebutkan kebijakan pengiriman di halaman terpisah yang mudah ditemukan.',
    'Tampilkan perkiraan ongkir atau syarat gratis ongkir sedini mungkin, bahkan di halaman produk.',
    'Cantumkan jam batas pemrosesan pesanan agar estimasi tiba tidak menimbulkan salah paham.',
    'Jelaskan wilayah yang tidak Anda layani, bila ada, sebelum pembeli mengisi alamat.',
    'Beritahu apa yang terjadi bila paket rusak atau hilang, termasuk siapa yang mengurus klaimnya.',
  ] },
  { type: 'h2', text: 'Jangan Abaikan Kualitas Kemasan' },
  { type: 'p', text: 'Ongkir yang dihitung rapi jadi sia-sia kalau barang tiba dalam kondisi penyok. Kemasan yang pas ukurannya menekan berat volumetrik sekaligus melindungi isi. Sediakan beberapa ukuran kotak standar, gunakan pengisi ruang seperlunya, dan pastikan label alamat tercetak jelas. Biaya tambahan untuk kemasan yang layak hampir selalu lebih murah daripada biaya mengganti barang rusak plus reputasi yang ikut lecet.' },
  { type: 'p', text: 'Bila Anda ingin toko Anda menghitung ongkir otomatis dan menyambungkan pelacakan resi ke halaman pesanan, PT Karya Cipta Solusi bisa membantu meninjau kebutuhannya lebih dulu lewat konsultasi gratis.' },
];

export default content;
