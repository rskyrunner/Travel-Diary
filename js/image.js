// Turns a camera photo into a compact, readable receipt image.
const MAX_SIDE = 1800;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

// Greyscale + contrast stretch: makes faded thermal-paper receipts easier to read.
function enhance(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
    px[i] = g; hist[g]++;
  }
  const total = w * h;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.05) { hi = v; break; } }
  if (hi - lo < 30) { lo = Math.max(0, lo - 15); hi = Math.min(255, hi + 15); }
  const scale = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    let g = (px[i] - lo) * scale;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(data, 0, 0);
}

export async function processReceipt(file, doEnhance) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: doEnhance });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  if (doEnhance) enhance(ctx, w, h);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Could not process that image.');
  return { data: await blob.arrayBuffer(), type: 'image/jpeg', width: w, height: h };
}
