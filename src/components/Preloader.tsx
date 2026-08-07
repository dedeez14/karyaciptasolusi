import { useState, useEffect } from 'react';

export default function Preloader() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`preloader ${loaded ? 'loaded' : ''}`}>
      <div className="flex flex-col items-center gap-5">
        <img
          src="/images/logo-main.png"
          alt="KCS"
          className="preloader-logo w-20 h-20 object-contain"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div className="preloader-bar">
          <div className="preloader-bar-inner" />
        </div>
        <p className="text-xs font-semibold tracking-[0.2em] uppercase" style={{ color: '#1D4ED8' }}>
          Memuat
        </p>
      </div>
    </div>
  );
}
