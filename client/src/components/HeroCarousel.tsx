import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const slides = [
  { id:1, title:'🛍️ Shop Now', subtitle:'Discover Our Amazing Collection', image:'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&q=80&auto=format&fit=crop', cta:'Shop Now' },
  { id:2, title:'🔥 Hot Deals', subtitle:'Up to 50% Off on Selected Items', image:'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200&q=60&auto=format&fit=crop', cta:'See Deals' },
  { id:3, title:'💻 Tech Essentials', subtitle:'Latest Gadgets and Electronics', image:'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=1200&q=60&auto=format&fit=crop', cta:'Shop Tech' },
];

export default function HeroCarousel() {
  const [, setSearchParams] = useSearchParams();
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const next = useCallback(() => setCurrent(c => (c + 1) % slides.length), []);
  const prev = () => setCurrent(c => (c - 1 + slides.length) % slides.length);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(next, 4000);
    return () => clearInterval(t);
  }, [paused, next]);
  const handleCTA = () => {
    setSearchParams({}, { replace: true });
    setTimeout(() => { document.querySelector('[data-products-section]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
  };
  const s = slides[current];
  const trackW = slides.length * 100 + '%';
  const trackX = 'translateX(-' + (current * 100 / slides.length) + '%)';
  const slideW = (100 / slides.length) + '%';
  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      style={{ position:'relative', width:'100%', height:'450px', borderRadius:'16px', overflow:'hidden', marginBottom:'2rem' }}>
      <div style={{ display:'flex', height:'100%', width:trackW, transform:trackX, transition:'transform 0.6s ease-in-out' }}>
        {slides.map(sl => (
          <div key={sl.id} style={{ position:'relative', height:'100%', width:slideW, flexShrink:0 }}>
            {sl.id === 1 ? (
              // First slide: use CSS background for instant render (no JS needed)
              <div
                style={{
                  position:'absolute', inset:0,
                  backgroundImage:`url('${sl.image}')`,
                  backgroundSize:'cover',
                  backgroundPosition:'center',
                }}
                role="img"
                aria-label={sl.title}
              />
            ) : (
              <img
                src={sl.image}
                alt=""
                loading="lazy"
                decoding="async"
                width={1200}
                height={450}
                style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}
              />
            )}
            <div style={{ position:'absolute', inset:0, background:'linear-gradient(to right,rgba(0,0,0,0.7),rgba(0,0,0,0.3),transparent)' }} />
            <div style={{ position:'relative', height:'100%', display:'flex', alignItems:'center', padding:'0 3rem' }}>
              <div style={{ maxWidth:'500px' }}>
                <h2 style={{ fontSize:'2.5rem', fontWeight:700, color:'#fff', marginBottom:'0.75rem' }}>{sl.title}</h2>
                <p style={{ fontSize:'1.2rem', color:'#e5e7eb', marginBottom:'1.5rem' }}>{sl.subtitle}</p>
                <button onClick={handleCTA} style={{ background:'#fff', color:'#111', padding:'0.75rem 2rem', borderRadius:'8px', fontWeight:600, border:'none', cursor:'pointer' }}>{sl.cta} →</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={prev} style={{ position:'absolute', left:'12px', top:'50%', transform:'translateY(-50%)', zIndex:10, width:'40px', height:'40px', borderRadius:'50%', background:'rgba(0,0,0,0.5)', color:'#fff', border:'none', fontSize:'1.5rem', cursor:'pointer' }}>‹</button>
      <button onClick={next} style={{ position:'absolute', right:'12px', top:'50%', transform:'translateY(-50%)', zIndex:10, width:'40px', height:'40px', borderRadius:'50%', background:'rgba(0,0,0,0.5)', color:'#fff', border:'none', fontSize:'1.5rem', cursor:'pointer' }}>›</button>
      <div style={{ position:'absolute', bottom:'16px', left:'50%', transform:'translateX(-50%)', zIndex:10, display:'flex', gap:'8px' }}>
        {slides.map((_,i) => (
          <button key={i} onClick={() => setCurrent(i)} style={{ width:i===current?'24px':'10px', height:'10px', borderRadius:'9999px', background:i===current?'#fff':'rgba(255,255,255,0.5)', border:'none', cursor:'pointer', padding:0, transition:'all 0.3s' }} />
        ))}
      </div>
      <div style={{ position:'absolute', top:'12px', right:'12px', zIndex:10, background:'rgba(0,0,0,0.4)', color:'#fff', padding:'4px 12px', borderRadius:'9999px', fontSize:'13px' }}>{current+1} / {slides.length}</div>
    </div>
  );
}
