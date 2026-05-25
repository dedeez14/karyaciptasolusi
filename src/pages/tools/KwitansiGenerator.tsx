import { useState, useRef } from 'react';
import { useReactToPrint } from 'react-to-print';

function formatRupiah(n: number) {
  return 'Rp ' + n.toLocaleString('id-ID');
}

function terbilang(n: number): string {
  const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  if (n < 12) return satuan[n];
  if (n < 20) return satuan[n - 10] + ' belas';
  if (n < 100) return satuan[Math.floor(n / 10)] + ' puluh ' + satuan[n % 10];
  if (n < 200) return 'seratus ' + terbilang(n - 100);
  if (n < 1000) return satuan[Math.floor(n / 100)] + ' ratus ' + terbilang(n % 100);
  if (n < 2000) return 'seribu ' + terbilang(n - 1000);
  if (n < 1000000) return terbilang(Math.floor(n / 1000)) + ' ribu ' + terbilang(n % 1000);
  if (n < 1000000000) return terbilang(Math.floor(n / 1000000)) + ' juta ' + terbilang(n % 1000000);
  return terbilang(Math.floor(n / 1000000000)) + ' miliar ' + terbilang(n % 1000000000);
}

export default function KwitansiGenerator() {
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef });

  const [noKwitansi, setNoKwitansi] = useState('KW/KCS/2026/001');
  const [tanggal, setTanggal] = useState(new Date().toISOString().split('T')[0]);
  const [terimaDari, setTerimaDari] = useState('');
  const [jumlah, setJumlah] = useState(0);
  const [pembayaran, setPembayaran] = useState('');
  const [metode, setMetode] = useState('Transfer Bank');

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h3 className="font-bold text-[#2D2D3A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Data Kwitansi</h3>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">No. Kwitansi</label>
            <input value={noKwitansi} onChange={e => setNoKwitansi(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
          <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">Tanggal</label>
            <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
        </div>

        <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">Sudah Terima Dari</label>
          <input value={terimaDari} onChange={e => setTerimaDari(e.target.value)} placeholder="Nama pemberi/pembayar" className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>

        <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">Jumlah Uang (Rp)</label>
          <input type="number" value={jumlah} onChange={e => setJumlah(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>

        <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">Untuk Pembayaran</label>
          <textarea value={pembayaran} onChange={e => setPembayaran(e.target.value)} rows={2} placeholder="Contoh: Pembayaran jasa pembuatan aplikasi ERP" className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>

        <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">Metode Pembayaran</label>
          <select value={metode} onChange={e => setMetode(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942] bg-white">
            <option>Transfer Bank</option><option>Tunai</option><option>QRIS</option><option>Check/Giro</option>
          </select></div>

        <button onClick={() => handlePrint()} className="w-full py-3 bg-[#F4B942] text-white font-bold rounded-xl hover:bg-[#D4941A] transition-colors">
          Print / Download PDF
        </button>
      </div>

      {/* PREVIEW */}
      <div>
        <h3 className="font-bold text-[#2D2D3A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Preview</h3>
        <div ref={printRef} className="bg-white p-10 rounded-xl border border-[#F0E6D3] shadow-sm" style={{ fontFamily: "'Inter', sans-serif" }}>
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-2">
              <img src="/images/logo-main.png" alt="" className="w-12 h-12 object-contain" />
              <div className="text-left"><p className="font-bold text-[#2D2D3A] text-sm">PT Karya Cipta Solusi</p><p className="text-[10px] text-[#D4941A] font-bold tracking-wider">SOLUSI TEKNOLOGI</p></div>
            </div>
            <p className="text-[9px] text-[#6B6B7B]">Kp. Sindangkarsa, RT.05/RW.15, Sukamaju Baru, Tapos, Depok 16455</p>
            <p className="text-[9px] text-[#6B6B7B]">Telp: 0856-0177-1312 | Email: febriansyahd65@gmail.com</p>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold tracking-widest text-[#2D2D3A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>KWITANSI</h2>
            <p className="text-xs text-[#6B6B7B] mt-1">No: {noKwitansi}</p>
          </div>

          <div className="space-y-4 mb-10">
            <div className="flex border-b border-[#F0E6D3] pb-2">
              <span className="w-36 text-xs font-semibold text-[#6B6B7B]">Sudah Terima Dari</span>
              <span className="text-xs font-bold text-[#2D2D3A] flex-1">: {terimaDari || '................................................................'}</span>
            </div>
            <div className="flex border-b border-[#F0E6D3] pb-2">
              <span className="w-36 text-xs font-semibold text-[#6B6B7B]">Jumlah Uang</span>
              <span className="text-xs font-bold text-[#2D2D3A] flex-1">: {formatRupiah(jumlah)}</span>
            </div>
            <div className="flex border-b border-[#F0E6D3] pb-2">
              <span className="w-36 text-xs font-semibold text-[#6B6B7B]">Terbilang</span>
              <span className="text-xs font-bold text-[#2D2D3A] flex-1 italic">: {jumlah > 0 ? terbilang(Math.floor(jumlah)) + ' rupiah' : '................................................................'}</span>
            </div>
            <div className="flex border-b border-[#F0E6D3] pb-2">
              <span className="w-36 text-xs font-semibold text-[#6B6B7B]">Untuk Pembayaran</span>
              <span className="text-xs text-[#2D2D3A] flex-1">: {pembayaran || '................................................................'}</span>
            </div>
            <div className="flex border-b border-[#F0E6D3] pb-2">
              <span className="w-36 text-xs font-semibold text-[#6B6B7B]">Metode</span>
              <span className="text-xs text-[#2D2D3A] flex-1">: {metode}</span>
            </div>
          </div>

          <div className="flex justify-between items-end">
            <div className="bg-[#FFF8E7] px-4 py-3 rounded-lg">
              <p className="text-xl font-bold" style={{ color: '#D4941A' }}>{formatRupiah(jumlah)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[#6B6B7B] mb-1">Depok, {tanggal ? new Date(tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '........................'}</p>
              <p className="text-[10px] text-[#6B6B7B] mb-8">Yang Menerima,</p>
              <p className="text-xs font-bold text-[#2D2D3A]">PT Karya Cipta Solusi</p>
              <div className="w-24 h-[1px] bg-[#2D2D3A] mx-auto mb-1"></div>
              <p className="text-[10px] text-[#6B6B7B]">Direktur</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
