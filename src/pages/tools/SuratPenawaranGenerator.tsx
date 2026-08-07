import { useState, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';

function formatRupiah(n: number) {
  return 'Rp ' + n.toLocaleString('id-ID');
}

interface PenawaranItem {
  id: number;
  nama: string;
  spesifikasi: string;
  harga: number;
}

export default function SuratPenawaranGenerator() {
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef });

  const [noSurat, setNoSurat] = useState('SP/KCS/2026/001');
  const [tanggal, setTanggal] = useState(new Date().toISOString().split('T')[0]);
  const [kepada, setKepada] = useState('');
  const [perusahaan, setPerusahaan] = useState('');
  const [alamat, setAlamat] = useState('');
  const [perihal, setPerihal] = useState('Penawaran Jasa Pengembangan Aplikasi');
  const [items, setItems] = useState<PenawaranItem[]>([{ id: 1, nama: '', spesifikasi: '', harga: 0 }]);
  const [penutup, setPenutup] = useState('Demikian penawaran ini kami sampaikan. Atas perhatian dan kerjasamanya, kami ucapkan terima kasih.');

  const addItem = () => setItems([...items, { id: Date.now(), nama: '', spesifikasi: '', harga: 0 }]);
  const removeItem = (id: number) => setItems(items.filter(i => i.id !== id));
  const updateItem = (id: number, field: keyof PenawaranItem, value: string | number) => {
    setItems(items.map(i => i.id === id ? { ...i, [field]: value } : i));
  };

  const total = items.reduce((sum, i) => sum + i.harga, 0);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h3 className="font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Data Surat Penawaran</h3>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-semibold text-[#475569] mb-1 block">No. Surat</label>
            <input value={noSurat} onChange={e => setNoSurat(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>
          <div><label className="text-xs font-semibold text-[#475569] mb-1 block">Tanggal</label>
            <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>
        </div>

        <div><label className="text-xs font-semibold text-[#475569] mb-1 block">Kepada Yth.</label>
          <input value={kepada} onChange={e => setKepada(e.target.value)} placeholder="Nama penerima" className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>
        <div><label className="text-xs font-semibold text-[#475569] mb-1 block">Perusahaan</label>
          <input value={perusahaan} onChange={e => setPerusahaan(e.target.value)} placeholder="Nama perusahaan klien" className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>
        <div><label className="text-xs font-semibold text-[#475569] mb-1 block">Alamat</label>
          <textarea value={alamat} onChange={e => setAlamat(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>
        <div><label className="text-xs font-semibold text-[#475569] mb-1 block">Perihal</label>
          <input value={perihal} onChange={e => setPerihal(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-[#475569]">Daftar Penawaran</label>
            <button onClick={addItem} className="flex items-center gap-1 text-xs font-semibold text-[#1D4ED8]"><Plus size={14} /> Tambah</button>
          </div>
          {items.map((item) => (
            <div key={item.id} className="grid grid-cols-12 gap-2 mb-2 items-end">
              <div className="col-span-4"><input value={item.nama} onChange={e => updateItem(item.id, 'nama', e.target.value)} placeholder="Nama item" className="w-full px-2 py-1.5 rounded border border-[#E2E8F0] text-xs focus:outline-none focus:border-[#2563EB]" /></div>
              <div className="col-span-5"><input value={item.spesifikasi} onChange={e => updateItem(item.id, 'spesifikasi', e.target.value)} placeholder="Spesifikasi" className="w-full px-2 py-1.5 rounded border border-[#E2E8F0] text-xs focus:outline-none focus:border-[#2563EB]" /></div>
              <div className="col-span-2"><input type="number" value={item.harga} onChange={e => updateItem(item.id, 'harga', Number(e.target.value))} placeholder="Harga" className="w-full px-2 py-1.5 rounded border border-[#E2E8F0] text-xs focus:outline-none focus:border-[#2563EB]" /></div>
              <div className="col-span-1">{items.length > 1 && <button onClick={() => removeItem(item.id)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>}</div>
            </div>
          ))}
        </div>

        <div><label className="text-xs font-semibold text-[#475569] mb-1 block">Penutup</label>
          <textarea value={penutup} onChange={e => setPenutup(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>

        <button onClick={() => handlePrint()} className="w-full py-3 bg-[#2563EB] text-white font-bold rounded-xl hover:bg-[#1D4ED8] transition-colors">
          Print / Download PDF
        </button>
      </div>

      {/* PREVIEW */}
      <div>
        <h3 className="font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Preview</h3>
        <div ref={printRef} className="bg-white p-10 rounded-xl border border-[#E2E8F0] shadow-sm" style={{ fontFamily: "'Inter', sans-serif" }}>
          <div className="flex items-center gap-3 mb-6">
            <img src="/images/logo-main.png" alt="" className="w-14 h-14 object-contain" />
            <div><p className="font-bold text-[#0F172A]">PT Karya Cipta Solusi</p><p className="text-[10px] text-[#1D4ED8] font-bold tracking-wider">SOLUSI TEKNOLOGI</p>
              <p className="text-[9px] text-[#475569]">Kp. Sindangkarsa, RT.05/RW.15, Sukamaju Baru, Tapos, Depok 16455</p>
              <p className="text-[9px] text-[#475569]">Telp: 0838-9891-1244 | Email: pt.karyaciptasolusi@gmail.com</p>
            </div>
          </div>

          <div className="mb-6 text-right">
            <p className="text-xs text-[#475569]">Depok, {tanggal ? new Date(tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '........................'}</p>
            <p className="text-xs text-[#475569]">No: {noSurat}</p>
          </div>

          <div className="mb-6">
            <p className="text-xs text-[#475569]">Kepada Yth.</p>
            <p className="text-sm font-bold text-[#0F172A]">{kepada || '........................'}</p>
            <p className="text-xs font-bold text-[#0F172A]">{perusahaan || '........................'}</p>
            <p className="text-[10px] text-[#475569]">{alamat || '........................'}</p>
          </div>

          <div className="mb-4">
            <p className="text-xs text-[#475569]">Perihal: <span className="font-bold text-[#0F172A]">{perihal}</span></p>
          </div>

          <div className="mb-4">
            <p className="text-xs text-[#0F172A] leading-relaxed mb-3">Dengan hormat,</p>
            <p className="text-xs text-[#0F172A] leading-relaxed mb-3">Sehubungan dengan kebutuhan {perusahaan || 'Bapak/Ibu'}, kami sampaikan penawaran harga sebagai berikut:</p>

            <table className="w-full mb-4">
              <thead><tr className="border-b-2 border-[#2563EB]">
                <th className="text-left text-[10px] font-bold text-[#475569] uppercase py-2 w-8">No</th>
                <th className="text-left text-[10px] font-bold text-[#475569] uppercase py-2">Nama Layanan/Produk</th>
                <th className="text-left text-[10px] font-bold text-[#475569] uppercase py-2">Spesifikasi</th>
                <th className="text-right text-[10px] font-bold text-[#475569] uppercase py-2 w-28">Harga</th>
              </tr></thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.id} className="border-b border-[#E2E8F0]">
                    <td className="py-2 text-xs text-[#475569]">{idx + 1}</td>
                    <td className="py-2 text-xs text-[#0F172A] font-medium">{item.nama || '-'}</td>
                    <td className="py-2 text-xs text-[#475569]">{item.spesifikasi || '-'}</td>
                    <td className="py-2 text-xs text-right font-semibold text-[#0F172A]">{formatRupiah(item.harga)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-end mb-4">
              <div className="w-48 flex justify-between py-2 border-t-2 border-[#2563EB]">
                <span className="text-sm font-bold text-[#0F172A]">TOTAL</span>
                <span className="text-sm font-bold" style={{ color: '#1D4ED8' }}>{formatRupiah(total)}</span>
              </div>
            </div>

            <p className="text-[10px] text-[#475569] italic mb-3">* Harga di atas belum termasuk PPN 11%</p>
            <p className="text-[10px] text-[#475569] italic mb-3">* Masa berlaku penawaran 14 hari sejak tanggal surat</p>
          </div>

          <p className="text-xs text-[#0F172A] leading-relaxed mb-8">{penutup}</p>

          <div className="text-right">
            <p className="text-xs text-[#475569] mb-8">Hormat Kami,</p>
            <p className="text-sm font-bold text-[#0F172A]">PT Karya Cipta Solusi</p>
            <div className="w-28 h-[1px] bg-[#0F172A] inline-block mb-1"></div>
            <p className="text-[10px] text-[#475569]">Direktur</p>
          </div>
        </div>
      </div>
    </div>
  );
}
