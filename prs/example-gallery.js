// ==/UserScript==

(function () {
  'use strict';

  // ========== USER SETTINGS ==========
  const DEFAULT_COLUMNS = 5;   // 2–8
  const DEFAULT_ZOOM = 100;    // 100–200 (%)
  const ZOOM_HOVER_TIME = 1000;
  // ===================================

  function createGalleryButton() {
    const button = document.createElement('button');
    button.textContent = '🖼️ View as Gallery';
    Object.assign(button.style, {
      position: 'fixed', top: '20px', right: '20px', zIndex: '9998',
      padding: '10px 15px', fontSize: '16px',
      background: '#4CAF50', color: 'white', border: 'none',
      borderRadius: '5px', cursor: 'pointer',
      fontFamily: 'Arial, sans-serif',
      boxShadow: '0 2px 10px rgba(0,0,0,0.3)'
    });
    button.addEventListener('mouseenter', () => { button.style.background = '#45a049'; });
    button.addEventListener('mouseleave', () => { button.style.background = '#4CAF50'; });
    button.onclick = openGallery;
    document.body.appendChild(button);
  }

  function forceLoadAll() {
    return new Promise((resolve) => {
      // Promote lazy-loaded images
      document.querySelectorAll('img[data-src]').forEach(img => {
        if (img.dataset.src && !img.src.includes(img.dataset.src)) img.src = img.dataset.src;
      });

      // Nudge lazy-loaders
      const observer = new IntersectionObserver(() => { /* noop */ });
      document.querySelectorAll('img[loading="lazy"]').forEach(img => observer.observe(img));

      // Gentle scroll to trigger loads
      let current = 0;
      const step = Math.max(64, Math.floor(window.innerHeight * 0.9));

      (function scroller() {
        current += step;
        window.scrollTo(0, current);
        if (current < document.body.scrollHeight - window.innerHeight) {
          setTimeout(scroller, 3);
        } else {
          window.scrollTo(0, document.body.scrollHeight);
          setTimeout(() => {
            window.scrollTo(0, 0);
            setTimeout(resolve, 400);
          }, 800);
        }
      })();
    });
  }

  // ---------- URL helpers ----------
  const IMG_EXT_RE = /\.(avif|webp|png|jpe?g|gif|bmp|tiff?)(?:[\?#].*)?$/i;

  function isLikelyImageUrl(href) {
    if (!href) return false;
    try {
      const u = new URL(href, location.href);
      return IMG_EXT_RE.test(u.pathname) || /\/data\//.test(u.pathname) || /\/attachments\//.test(u.pathname);
    } catch {
      return IMG_EXT_RE.test(href) || /\/data\//.test(href) || /\/attachments\//.test(href);
    }
  }

  function promoteThumbnail(url) {
    try {
      const u = new URL(url, location.href);
      // Common  thumbnail format: /thumbnail/… -> remove '/thumbnail/'
      if (u.pathname.includes('/thumbnail/')) {
        u.pathname = u.pathname.replace('/thumbnail/', '/');
      }
      return u.href;
    } catch {
      return url;
    }
  }

  function largestFromSrcset(img) {
    const set = img.getAttribute('srcset');
    if (!set) return null;
    // pick the highest descriptor
    const candidates = set.split(',').map(s => s.trim()).map(part => {
      const [url, desc] = part.split(/\s+/);
      const val = desc && desc.endsWith('w') ? parseInt(desc) :
                  desc && desc.endsWith('x') ? parseFloat(desc) * 10000 : 0;
      return { url, val: isFinite(val) ? val : 0 };
    }).filter(c => c.url);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.val - a.val);
    return candidates[0].url;
  }

  function bestImageUrlFor(img) {
    // 1) Prefer closest link if it points to a real image
    const a = img.closest('a');
    if (a && isLikelyImageUrl(a.getAttribute('href'))) {
      return new URL(a.getAttribute('href'), location.href).href;
    }
    // 2) If thumbnail, promote to full-size
    if (img.src && img.src.includes('/thumbnail/')) {
      return promoteThumbnail(img.src);
    }
    // 3) Consider largest srcset candidate
    const fromSet = largestFromSrcset(img);
    if (fromSet && isLikelyImageUrl(fromSet)) {
      return new URL(fromSet, location.href).href;
    }
    // 4) Fallback to img.src
    return img.src;
  }

  function collectImageData() {
    const urls = new Set();
    const out = [];

    // Gather from <img> elements
    for (const img of Array.from(document.images)) {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w < 200 || h < 200) continue; // discard tiny UI bits

      const full = bestImageUrlFor(img);
      if (!full) continue;
      if (!isLikelyImageUrl(full)) continue;

      // Fallback: the original <img> src (likely thumbnail)
      const fallback = img.currentSrc || img.src || full;

      // Use tuple key to avoid duplicate full URLs
      if (!urls.has(full)) {
        urls.add(full);
        out.push({ src: full, fallback, original: img });
      }
    }

    // Also pick up any direct links to images that might not wrap an <img>
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href');
      if (!isLikelyImageUrl(href)) continue;
      const abs = new URL(href, location.href).href;
      if (!urls.has(abs)) {
        urls.add(abs);
        // No known thumbnail here; fallback = full
        out.push({ src: abs, fallback: abs, original: a });
      }
    }

    return out;
  }
  // ----------------------------------

  function attachFallback(imgEl, data) {
    // Ensure we only switch once to avoid loops
    imgEl.onerror = () => {
      if (imgEl.dataset.fallbackApplied === '1') return;
      imgEl.dataset.fallbackApplied = '1';
      if (data.fallback && data.fallback !== imgEl.src) {
        imgEl.src = data.fallback;
      }
    };
  }

  async function fetchWithFallback(url, fallbackUrl) {
    // Try full-size first, then fallback
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (fallbackUrl && fallbackUrl !== url) {
        const res2 = await fetch(fallbackUrl, { credentials: 'omit' });
        if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
        return res2;
      }
      throw e;
    }
  }

  function openGallery() {
    const loadingDiv = document.createElement('div');
    loadingDiv.textContent = 'Loading all images...';
    Object.assign(loadingDiv.style, {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      background: 'rgba(0,0,0,0.8)', color: 'white', padding: '20px',
      borderRadius: '10px', zIndex: '9998', fontSize: '18px'
    });
    document.body.appendChild(loadingDiv);

    forceLoadAll().then(() => {
      document.body.removeChild(loadingDiv);

      let imageData = collectImageData();
      if (!imageData.length) return alert('No qualifying images found.');

      // ====== Gallery UI ======
      const gallery = document.createElement('div');
      Object.assign(gallery.style, {
        display: 'grid',
        gridTemplateColumns: `repeat(${DEFAULT_COLUMNS}, 1fr)`,
        gap: '8px',
        padding: '50px 10px 10px',
        background: '#1a1a1a',
        zIndex: '9999',
        position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
        overflowY: 'scroll'
      });

      const controlBar = document.createElement('div');
      Object.assign(controlBar.style, {
        position: 'fixed', top: '0', left: '0', right: '0', height: '40px',
        background: '#2d2d2d', zIndex: '10001', display: 'flex',
        alignItems: 'center', padding: '5px 10px', borderBottom: '1px solid #444'
      });

      const columnLabel = Object.assign(document.createElement('span'), { textContent: 'Columns: ' });
      Object.assign(columnLabel.style, { marginRight: '8px', color: '#e0e0e0' });

      const columnSlider = Object.assign(document.createElement('input'), { type: 'range', min: '2', max: '8', value: String(DEFAULT_COLUMNS) });
      columnSlider.style.marginRight = '15px';

      const columnValue = Object.assign(document.createElement('span'), { textContent: String(DEFAULT_COLUMNS) });
      Object.assign(columnValue.style, { marginRight: '20px', color: '#e0e0e0' });

      const zoomLabel = Object.assign(document.createElement('span'), { textContent: 'Hover Zoom: ' });
      Object.assign(zoomLabel.style, { marginRight: '8px', color: '#e0e0e0' });

      const zoomSlider = Object.assign(document.createElement('input'), { type: 'range', min: '100', max: '200', value: String(DEFAULT_ZOOM) });
      zoomSlider.style.marginRight = '8px';

      const zoomValue = Object.assign(document.createElement('span'), { textContent: DEFAULT_ZOOM + '%' });
      Object.assign(zoomValue.style, { marginRight: '20px', color: '#e0e0e0' });

      columnSlider.oninput = () => {
        gallery.style.gridTemplateColumns = `repeat(${columnSlider.value}, 1fr)`;
        columnValue.textContent = columnSlider.value;
      };
      zoomSlider.oninput = () => { zoomValue.textContent = zoomSlider.value + '%'; };

      const downloadBtn = document.createElement('button');
      downloadBtn.innerText = '📦 Download ZIP';
      Object.assign(downloadBtn.style, {
        marginRight: '10px', fontSize: '16px', background: '#4CAF50', color: 'white',
        border: 'none', padding: '5px 10px', borderRadius: '3px', cursor: 'pointer'
      });

      downloadBtn.onclick = async () => {
        downloadBtn.disabled = true;
        downloadBtn.innerText = 'Downloading...';
        try {
          // Load JSZip dynamically
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
          document.head.appendChild(script);
          await new Promise(r => script.onload = r);

          const zip = new JSZip();
          const tasks = imageData.map(async (data, i) => {
            try {
              const res = await fetchWithFallback(data.src, data.fallback);
              const blob = await res.blob();
              const ext = (data.src.split('.').pop() || 'jpg').split('?')[0];
              zip.file(`image_${String(i + 1).padStart(3, '0')}.${ext}`, blob);
            } catch (e) {
              console.warn('Failed to download (both full & fallback):', data.src, e);
            }
          });

          await Promise.all(tasks);
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          const url = URL.createObjectURL(zipBlob);
          const a = document.createElement('a');
          a.href = url;
          const tabName = document.title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100) || 'gallery_images';
          a.download = tabName + '.zip';
          a.click();
          URL.revokeObjectURL(url);
        } catch (err) {
          alert('Download failed: ' + err.message);
        } finally {
          downloadBtn.disabled = false;
          downloadBtn.innerText = '📦 Download ZIP';
        }
      };

      const close = document.createElement('button');
      close.innerText = '✕ Close';
      Object.assign(close.style, {
        marginLeft: 'auto', fontSize: '16px', background: '#ff4444', color: 'white',
        border: 'none', padding: '5px 10px', borderRadius: '3px', cursor: 'pointer'
      });

      function galleryPopstateHandler() {
        if (document.body.contains(gallery)) {
          history.pushState({ gallery: true }, '', location.href);
          close.onclick();
        }
      }

      close.onclick = () => {
        document.body.removeChild(gallery);
        document.body.removeChild(controlBar);
        window.removeEventListener('popstate', galleryPopstateHandler);
      };

      history.pushState({ gallery: true }, '', location.href);
      window.addEventListener('popstate', galleryPopstateHandler);

      controlBar.appendChild(columnLabel);
      controlBar.appendChild(columnSlider);
      controlBar.appendChild(columnValue);
      controlBar.appendChild(zoomLabel);
      controlBar.appendChild(zoomSlider);
      controlBar.appendChild(zoomValue);
      controlBar.appendChild(downloadBtn);
      controlBar.appendChild(close);

      // Thumbs
      imageData.forEach((data, index) => {
        const img = document.createElement('img');
        img.src = data.src; // try full-size first
        attachFallback(img, data); // fallback to thumbnail on error
        Object.assign(img.style, {
          width: '100%', height: 'auto', cursor: 'pointer',
          borderRadius: '2px', transition: 'transform 0.25s ease',
          transitionDelay: ZOOM_HOVER_TIME + 'ms',
          border: '1px solid #333'
        });
        img.loading = 'lazy';

        img.onmouseenter = () => {
          const scale = zoomSlider.value / 100;
          img.style.transform = `scale(${scale})`;
          img.style.zIndex = '10010';
          img.style.position = 'relative';
        };
        img.onmouseleave = () => {
          img.style.transform = 'scale(1)';
          img.style.zIndex = 'auto';
          img.style.position = 'static';
        };

        img.onclick = () => openFullscreen(index, imageData, gallery, controlBar);
        gallery.appendChild(img);
      });

      document.body.appendChild(controlBar);
      document.body.appendChild(gallery);
    });
  }

  function openFullscreen(startIndex, imageData, gallery, controlBar) {
    let currentIndex = startIndex;

    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.95)',
      zIndex: '10020', display: 'flex', alignItems: 'center',
      justifyContent: 'center', opacity: '0', transition: 'opacity 0.3s ease'
    });

    gallery.style.opacity = '0.3';
    controlBar.style.opacity = '0.3';

    const container = document.createElement('div');
    Object.assign(container.style, {
      width: '100vw', height: '100vh', display: 'flex',
      alignItems: 'center', justifyContent: 'center', position: 'relative'
    });

    const fsImg = document.createElement('img');
    Object.assign(fsImg.style, {
      width: '100vw', height: '100vh', objectFit: 'contain', background: '#000'
    });

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '‹';
    Object.assign(prevBtn.style, {
      position: 'absolute', left: '-60px', top: '50%', transform: 'translateY(-50%)',
      width: '50px', height: '50px', borderRadius: '50%',
      background: 'rgba(255,255,255,0.2)', color: 'white',
      border: 'none', fontSize: '24px', cursor: 'pointer'
    });

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = '›';
    Object.assign(nextBtn.style, {
      position: 'absolute', right: '-60px', top: '50%', transform: 'translateY(-50%)',
      width: '50px', height: '50px', borderRadius: '50%',
      background: 'rgba(255,255,255,0.2)', color: 'white',
      border: 'none', fontSize: '24px', cursor: 'pointer'
    });

    const fsClose = document.createElement('button');
    fsClose.innerHTML = '✕';
    Object.assign(fsClose.style, {
      position: 'absolute', top: '20px', right: '20px',
      width: '40px', height: '40px', borderRadius: '50%',
      background: 'rgba(255,255,255,0.2)', color: 'white',
      border: 'none', fontSize: '18px', cursor: 'pointer'
    });

    const counter = document.createElement('div');
    Object.assign(counter.style, {
      position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      color: 'white', background: 'rgba(0,0,0,0.7)', padding: '8px 16px',
      borderRadius: '20px', fontSize: '14px'
    });

    function updateImage() {
      const data = imageData[currentIndex];
      fsImg.dataset.fallbackApplied = '0';
      attachFallback(fsImg, data);
      fsImg.src = data.src; // try full-size first, fallback onerror
      counter.textContent = `${currentIndex + 1} / ${imageData.length}`;
      prevBtn.style.opacity = currentIndex === 0 ? '0.3' : '1';
      nextBtn.style.opacity = currentIndex === imageData.length - 1 ? '0.3' : '1';
    }

    function showPrevious() { if (currentIndex > 0) { currentIndex--; updateImage(); } }
    function showNext() { if (currentIndex < imageData.length - 1) { currentIndex++; updateImage(); } }

    function closeFullscreen() {
      overlay.style.opacity = '0';
      gallery.style.opacity = '1';
      controlBar.style.opacity = '1';
      window.removeEventListener('keydown', keyHandler);
      window.removeEventListener('popstate', fsPop);
      setTimeout(() => { if (document.body.contains(overlay)) document.body.removeChild(overlay); }, 300);
    }

    function fsPop() {
      if (document.body.contains(overlay)) {
        history.pushState({ fullscreen: true }, '', location.href);
        closeFullscreen();
      }
    }

    function keyHandler(e) {
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); showPrevious(); break;
        case 'ArrowRight': e.preventDefault(); showNext(); break;
        case 'Escape':
        case 'Backspace': e.preventDefault(); closeFullscreen(); break;
      }
    }

    prevBtn.onclick = showPrevious;
    nextBtn.onclick = showNext;
    fsClose.onclick = closeFullscreen;

    overlay.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaX > 0 || e.deltaY > 0) showNext();
      else if (e.deltaX < 0 || e.deltaY < 0) showPrevious();
    }, { passive: false });

    overlay.onclick = (e) => { if (e.target === overlay) closeFullscreen(); };

    window.addEventListener('keydown', keyHandler);
    history.pushState({ fullscreen: true }, '', location.href);
    window.addEventListener('popstate', fsPop);

    container.appendChild(fsImg);
    container.appendChild(prevBtn);
    container.appendChild(nextBtn);
    overlay.appendChild(container);
    overlay.appendChild(fsClose);
    overlay.appendChild(counter);
    document.body.appendChild(overlay);

    updateImage();
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createGalleryButton);
  } else {
    createGalleryButton();
  }
})();
