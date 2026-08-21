const express = require('express');
const puppeteer = require('puppeteer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');
// ffmpeg is installed as a system package via nixpacks.toml — no path override needed

const app = express();
app.use(express.json({ limit: '20mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', version: '2026-04-11-v14', endpoints: ['render', 'render-carousel', 'render-rebrand', 'render-rebrand-batch', 'render-generate-batch', 'render-aima', 'render-story'] }));

app.post('/render', async (req, res) => {
  const { background_url, inset_url, headline } = req.body;

  if (!background_url || !headline) {
    return res.status(400).json({ error: 'Missing required fields: background_url, headline' });
  }

  const imgbbKey = process.env.IMGBB_API_KEY;
  if (!imgbbKey) {
    return res.status(500).json({ error: 'IMGBB_API_KEY environment variable not set' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    await page.setContent(buildHtml(background_url, inset_url || '', headline), {
      waitUntil: 'networkidle0',
      timeout: 20000,
    });
    const buffer = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
    await browser.close();
    browser = null;

    const imageUrl = await uploadToImgbb(buffer, imgbbKey);
    res.json({ success: true, image_url: imageUrl });
  } catch (err) {
    console.error('Render error:', err.message);
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

async function uploadToImgbb(buffer, apiKey) {
  const base64 = buffer.toString('base64');
  const body = new URLSearchParams({ image: base64 });

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(`imgbb upload failed: ${JSON.stringify(data.error || data)}`);
  }
  return data.data.url;
}

function buildHtml(bg, inset, headline) {
  const safe = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const parseHeadline = (text) =>
    safe(text).replace(/\[\[(.+?)\]\]/g, '<span class="kw">$1</span>');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1350px; overflow: hidden; background: #000; }

  .bg {
    position: absolute;
    width: 100%; height: 100%;
    object-fit: cover;
    opacity: 0.82;
  }

  .overlay {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 60%;
    background: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.97) 100%);
  }

  .handle {
    position: absolute;
    bottom: 420px;
    left: 50%;
    transform: translateX(-50%);
    color: rgba(255,255,255,0.85);
    font-family: 'Montserrat', 'Arial Black', sans-serif;
    font-size: 22px;
    font-weight: 900;
    letter-spacing: 6px;
    text-shadow: 1px 1px 6px rgba(0,0,0,0.95);
    white-space: nowrap;
  }

  .headline {
    position: absolute;
    bottom: 50px;
    left: 28px;
    right: 28px;
    color: #fff;
    font-family: 'Montserrat', Impact, sans-serif;
    font-size: 80px;
    font-weight: 900;
    text-align: center;
    text-transform: uppercase;
    line-height: 1.0;
    letter-spacing: 1px;
    text-shadow: 3px 3px 8px rgba(0,0,0,0.95), 1px 1px 0 rgba(0,0,0,0.9);
    word-break: break-word;
  }

  .headline .kw { color: #4BB8D0; }
</style>
</head>
<body>
  <img class="bg" src="${safe(bg)}" crossorigin="anonymous">
  <div class="overlay"></div>
  <div class="handle">@BACKPAINLIFE</div>
  <div class="headline">${parseHeadline(headline)}</div>
</body>
</html>`;
}

app.post('/render-carousel', async (req, res) => {
  const { image_url, headline, template, slide_number, subtext } = req.body;

  if (!image_url || !headline || !template) {
    return res.status(400).json({ error: 'Missing required fields: image_url, headline, template' });
  }

  const imgbbKey = process.env.IMGBB_API_KEY;
  if (!imgbbKey) {
    return res.status(500).json({ error: 'IMGBB_API_KEY environment variable not set' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    await page.setContent(buildCarouselHtml(image_url, headline, template, slide_number, subtext), {
      waitUntil: 'networkidle0',
      timeout: 20000,
    });
    const buffer = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
    await browser.close();
    browser = null;

    const imageUrl = await uploadToImgbb(buffer, imgbbKey);
    res.json({ success: true, image_url: imageUrl });
  } catch (err) {
    console.error('Render carousel error:', err.message);
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

function buildCarouselHtml(imageUrl, headline, template, slideNumber, subtext) {
  const safe = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const parseHeadline = (text) =>
    safe(text).replace(/\[\[(.+?)\]\]/g, '<span class="kw">$1</span>');

  const parseSubtext = (text) =>
    safe(text || '').replace(/\\n/g, '<br>').replace(/\n/g, '<br>');

  const numStr = String(slideNumber || 1).padStart(2, '0');

  const fonts = `@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@900&family=Bebas+Neue&display=swap');`;

  if (template === 'cover') {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  ${fonts}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1350px; overflow: hidden; background: #000; }

  .bg {
    position: absolute;
    width: 100%; height: 100%;
    object-fit: cover;
    opacity: 0.9;
  }

  .overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to bottom,
      transparent 0%,
      transparent 50%,
      rgba(0,0,0,0.6) 65%,
      rgba(0,0,0,0.97) 80%,
      #000 100%
    );
  }

  .text-block {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 0 44px 52px 44px;
    text-align: center;
  }

  .headline {
    color: #fff;
    font-family: 'Montserrat', 'Bebas Neue', Impact, sans-serif;
    font-size: 80px;
    font-weight: 900;
    text-transform: uppercase;
    line-height: 1.0;
    letter-spacing: 1px;
    word-break: break-word;
  }

  .headline .kw { color: #4BB8D0; }

  .swipe {
    display: inline-block;
    margin-top: 18px;
    color: #4BB8D0;
    font-family: 'Montserrat', sans-serif;
    font-size: 26px;
    font-weight: 900;
    letter-spacing: 4px;
    text-transform: uppercase;
  }
</style>
</head>
<body>
  <img class="bg" src="${safe(imageUrl)}" crossorigin="anonymous">
  <div class="overlay"></div>
  <div class="text-block">
    <div class="headline">${parseHeadline(headline)}</div>
    ${String(slideNumber) === '1' ? '<div class="swipe">SWIPE →</div>' : ''}
  </div>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  ${fonts}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1350px; overflow: hidden; background: #000; }

  .bg {
    position: absolute;
    width: 100%; height: 100%;
    object-fit: cover;
    object-position: center center;
    opacity: 0.85;
  }

  .overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to bottom,
      transparent 0%,
      transparent 45%,
      rgba(0,0,0,0.55) 60%,
      rgba(0,0,0,0.92) 74%,
      #000 88%,
      #000 100%
    );
  }

  .badge {
    position: absolute;
    top: 20px; left: 20px;
    background: rgba(0,0,0,0.72);
    color: #4BB8D0;
    font-family: 'Montserrat', 'Bebas Neue', sans-serif;
    font-size: 26px;
    font-weight: 900;
    letter-spacing: 3px;
    padding: 4px 14px 2px;
    border-radius: 3px;
    z-index: 10;
  }

  .text-block {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 0 44px 48px 44px;
  }

  .headline {
    color: #fff;
    font-family: 'Montserrat', 'Bebas Neue', Impact, sans-serif;
    font-size: 82px;
    font-weight: 900;
    text-transform: uppercase;
    line-height: 0.94;
    letter-spacing: 1px;
    word-break: break-word;
    margin-bottom: 20px;
  }
  .headline .kw { color: #4BB8D0; }

  .subtext {
    color: rgba(255,255,255,0.90);
    font-family: 'Montserrat', Arial, sans-serif;
    font-size: 26px;
    font-weight: 600;
    line-height: 1.55;
  }
</style>
</head>
<body>
  <img class="bg" src="${safe(imageUrl)}" crossorigin="anonymous">
  <div class="overlay"></div>
  <div class="badge">${numStr}</div>
  <div class="text-block">
    <div class="headline">${parseHeadline(headline)}</div>
    <div class="subtext">${parseSubtext(subtext)}</div>
  </div>
</body>
</html>`;
}

app.post('/render-rebrand', async (req, res) => {
  const { slide_image_url, slide_number, total_slides } = req.body;

  if (!slide_image_url) {
    return res.status(400).json({ error: 'Missing required field: slide_image_url' });
  }

  const imgbbKey = process.env.IMGBB_API_KEY;
  if (!imgbbKey) {
    return res.status(500).json({ error: 'IMGBB_API_KEY environment variable not set' });
  }

  let imageDataUri;
  try {
    const imgResp = await fetch(slide_image_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });
    if (!imgResp.ok) throw new Error(`Image fetch failed: ${imgResp.status}`);
    const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
    const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
    imageDataUri = `data:${contentType};base64,${imgBuffer.toString('base64')}`;
  } catch (fetchErr) {
    console.error('Image fetch error:', fetchErr.message);
    imageDataUri = slide_image_url;
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
    await page.setContent(buildRebrandHtml(imageDataUri, slide_number || 1, total_slides || 1), {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    const buffer = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
    await browser.close();
    browser = null;

    const imageUrl = await uploadToImgbb(buffer, imgbbKey);
    res.json({ success: true, image_url: imageUrl });
  } catch (err) {
    console.error('Render rebrand error:', err.message);
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

app.post('/render-rebrand-batch', async (req, res) => {
  const { slides } = req.body;

  if (!Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: 'Missing required field: slides (array)' });
  }

  const imgbbKey = process.env.IMGBB_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!imgbbKey) return res.status(500).json({ error: 'IMGBB_API_KEY not set' });
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const results = [];
    for (const slide of slides) {
      // Video slides: FFmpeg processing — rebrand the actual video
      // Fallback: old queue data stored videoUrl in slide_image_url when is_video=true
      const effectiveVideoUrl = slide.slide_video_url ||
        (slide.is_video ? slide.slide_image_url : null);
      const effectiveThumbUrl = slide.slide_video_url ? slide.slide_image_url : null;
      if (slide.is_video && effectiveVideoUrl) {
        const slideForVideo = { ...slide, slide_video_url: effectiveVideoUrl, slide_image_url: effectiveThumbUrl };
        try {
          const result = await processVideoSlide(slideForVideo, openaiKey, browser);
          results.push(result);
        } catch (e) {
          console.error('Video processing error:', e.message, e.stack);
          // Fallback: render AIMABOOSTING branded text slide
          try {
            const caption = slide.original_caption || '';
            const short = caption.length > 200 ? caption.slice(0, 200).replace(/\s\S*$/, '...') : caption;
            const pg = await browser.newPage();
            await pg.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
            await pg.setContent(buildTextBlockHtml({
              body: short || null,
              slide_number: slide.slide_number,
              total_slides: slide.total_slides,
              width: 1080,
              height: 1080,
            }), { waitUntil: 'networkidle2', timeout: 10000 });
            const fbuf = await pg.screenshot({ type: 'jpeg', quality: 85 });
            await pg.close();
            const fallbackUrl = await uploadToImgbb(fbuf, imgbbKey);
            results.push({ image_url: fallbackUrl, is_video: false, already_cloudinary: false, slide_number: slide.slide_number, original_caption: slide.original_caption || '', post_id: slide.post_id || '', source_account: slide.source_account || '' });
          } catch (fe) {
            console.error('Fallback render error:', fe.message);
            results.push({ image_url: null, is_video: false, slide_number: slide.slide_number, original_caption: slide.original_caption || '', post_id: slide.post_id || '', source_account: slide.source_account || '' });
          }
        }
        continue;
      }

      // 1. Use pre-downloaded base64 from n8n (sent while Apify URL was fresh).
      //    Fallback: try fetching the URL directly (may fail if CDN expired).
      let base64Image = slide.slide_image_base64 || null;
      if (!base64Image && slide.slide_image_url) {
        try {
          const imgResp = await fetch(slide.slide_image_url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': 'https://www.instagram.com/',
              'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            },
          });
          if (imgResp.ok) {
            const buf = Buffer.from(await imgResp.arrayBuffer());
            base64Image = buf.toString('base64');
          }
        } catch (e) {
          console.error('Image download error:', e.message);
        }
      }
      console.log(`[slide ${slide.slide_number}] base64Image=${base64Image ? 'yes (' + Math.round(base64Image.length/1024) + 'KB)' : 'null'}`);

      // 2. Extract content with GPT-4o Vision
      let extracted = {};
      if (base64Image) {
        try {
          extracted = await extractSlideContent(base64Image, openaiKey);
        } catch (e) {
          console.error('Vision extraction error:', e.message);
          extracted = { slide_type: 'text', headline: null, body: null, bullets: null };
        }
      }

      // Caption fallback: if GPT Vision found no text, use original_caption
      if (!extracted.headline && !extracted.body && !(extracted.bullets && extracted.bullets.length)) {
        const caption = slide.original_caption || '';
        const short = caption.length > 200 ? caption.slice(0, 200).replace(/\s\S*$/, '...') : caption;
        extracted.body = short || null;
        extracted.slide_type = extracted.slide_type || 'content';
      }

      // ── Force cover for slide 1; elevate caption to headline for covers ────
      if (slide.slide_number === 1) extracted.slide_type = 'cover';
      if (extracted.slide_type === 'cover' && !extracted.headline) {
        const raw = extracted.body || slide.original_caption || '';
        // Strip leading emoji/symbols, grab first sentence (max 100 chars)
        const clean = raw.replace(/^[\p{Emoji}\s\u{1F300}-\u{1FFFF}]*/u, '').trim();
        const firstSentence = clean.split(/[.!?\n]/)[0].trim();
        extracted.headline = firstSentence.slice(0, 100) || null;
        extracted.body = null;
      }

      // ── Pexels fallback: if image fetch failed, search related photo ───────
      if (!base64Image && process.env.PEXELS_API_KEY) {
        const query = (extracted.headline || slide.original_caption || 'technology')
          .replace(/[^\w\s]/g, ' ').split(/\s+/).slice(0, 4).join(' ');
        console.log(`[cover] No original image — fetching Pexels: "${query}"`);
        base64Image = await fetchPexelsImage(query, process.env.PEXELS_API_KEY);
      }

      // 3. Build AIMABOOSTING branded slide
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
      // Use base64 data URI so Puppeteer browser doesn't need to fetch Instagram CDN
      const bgDataUri = base64Image ? `data:image/jpeg;base64,${base64Image}` : null;
      await page.setContent(buildSlideFromContent({
        ...extracted,
        slide_number: slide.slide_number || 1,
        total_slides: slide.total_slides || 1,
        imageUrl: bgDataUri,
        has_image: !!base64Image,
      }), { waitUntil: 'networkidle2', timeout: 15000 });
      const buffer = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
      await page.close();

      // 4. Upload — always as image (video slides are re-rendered as branded images)
      const imageUrl = await uploadToImgbb(buffer, imgbbKey);
      results.push({
        image_url: imageUrl,
        is_video: false,
        slide_number: slide.slide_number,
        original_caption: slide.original_caption || '',
        post_id: slide.post_id || '',
        source_account: slide.source_account || '',
      });
    }

    await browser.close();
    browser = null;
    res.json({ success: true, images: results });
  } catch (err) {
    console.error('Render rebrand batch error:', err.message);
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

async function processVideoSlide(slide, openaiKey, sharedBrowser) {
  const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const videoPath   = path.join(os.tmpdir(), `vid_${tag}.mp4`);
  const textPngPath = path.join(os.tmpdir(), `txt_${tag}.png`);
  const outputPath  = path.join(os.tmpdir(), `out_${tag}.mp4`);
  const cleanup = () => [videoPath, textPngPath, outputPath].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
  });

  try {
    // ── 1. Get thumbnail base64 — use pre-downloaded from n8n first (URL is still fresh there)
    let base64Thumb = slide.slide_image_base64 || null;
    let extracted = { slide_type: 'content', layout: 'text_top', headline: null, body: null, bullets: null, visual_top_pct: null };
    if (!base64Thumb && slide.slide_image_url) {
      try {
        const r = await fetch(slide.slide_image_url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.instagram.com/' } });
        if (r.ok) base64Thumb = Buffer.from(await r.arrayBuffer()).toString('base64');
      } catch (e) { console.error('Thumb fetch fallback error:', e.message); }
    }
    if (base64Thumb) {
      try { extracted = await extractSlideContent(base64Thumb, openaiKey); }
      catch (e) { console.error('Vision error:', e.message); }
    }
    if (!extracted.headline && !extracted.body && !(extracted.bullets && extracted.bullets.length)) {
      const cap = slide.original_caption || '';
      extracted.body = cap.length > 200 ? cap.slice(0, 200).replace(/\s\S*$/, '...') : cap || null;
    }

    // ── 2. COVER CHECK — slide 1 of any carousel is always the cover.
    // Also cover if GPT detected cover/text_bottom layout (image top, text bottom).
    const isCover = slide.slide_number === 1
      || extracted.slide_type === 'cover'
      || extracted.layout === 'text_bottom';

    if (isCover) {
      // Use base64 data URL so Puppeteer can render the image without hitting Instagram CDN
      const imageDataUrl = base64Thumb ? `data:image/jpeg;base64,${base64Thumb}` : null;
      const coverPage = await sharedBrowser.newPage();
      await coverPage.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
      await coverPage.setContent(buildSlideFromContent({
        ...extracted,
        slide_type: 'cover',
        has_image: !!imageDataUrl,
        imageUrl: imageDataUrl,
        slide_number: slide.slide_number,
        total_slides: slide.total_slides,
      }), { waitUntil: 'networkidle2', timeout: 15000 });
      const coverBuf = await coverPage.screenshot({ type: 'jpeg', quality: 90, fullPage: false });
      await coverPage.close();
      const imageUrl = await uploadToImgbb(coverBuf, process.env.IMGBB_API_KEY);
      cleanup();
      return { image_url: imageUrl, is_video: false, already_cloudinary: false, slide_number: slide.slide_number, original_caption: slide.original_caption || '', post_id: slide.post_id || '', source_account: slide.source_account || '' };
    }

    // ── 3. CONTENT VIDEO — download and compose
    const vr = await fetch(slide.slide_video_url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.instagram.com/' } });
    if (!vr.ok) throw new Error(`Video download failed: ${vr.status}`);
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(videoPath);
      const reader = vr.body.getReader();
      const pump = () => reader.read().then(({ done, value }) => {
        if (done) { writer.end(); return; }
        writer.write(Buffer.from(value), pump);
      }).catch(reject);
      writer.on('finish', resolve).on('error', reject);
      pump();
    });

    const dims = await new Promise((resolve) => {
      ffmpeg.ffprobe(videoPath, (err, meta) => {
        if (err) return resolve({ width: 1080, height: 1080, duration: 30 });
        const vs = (meta.streams || []).find(s => s.codec_type === 'video') || {};
        resolve({ width: vs.width || 1080, height: vs.height || 1080, duration: meta.format?.duration || 30 });
      });
    });

    // ── 4. Crop: use visual_top_pct from thumbnail analysis to cut out competitor's text region
    // The thumbnail (static layout image) shows exactly where their text ends and footage begins.
    // GPT returns visual_top_pct ≈ 0.35 if their text occupies top 35% of the frame.
    // When the thumbnail shows only footage (no text visible), GPT returns 0.0 — but the
    // actual video still has competitor branding baked into the top portion. Default to 0.33
    // so we always crop roughly the top third (where competitor text/logo lives) and replace
    // it with our AIMABOOSTING text block. If GPT detects a real value, that takes priority.
    const vtp = (typeof extracted.visual_top_pct === 'number' && extracted.visual_top_pct > 0.05)
      ? Math.min(extracted.visual_top_pct, 0.8)
      : 0.33;
    const vidW = dims.width;
    const vidH = dims.height;
    const cropY = Math.round(vidH * vtp);
    const cropH = vidH - cropY;
    console.log(`[video] vtp=${vtp} cropY=${cropY}/${vidH} duration=${dims.duration}s`);

    // ── 5. Render AIMABOOSTING text block (380px)
    const textH = 380;
    const videoH = 970; // total = 380+970 = 1350px (4:5 Instagram)

    const page = await sharedBrowser.newPage();
    await page.setViewport({ width: 1080, height: textH, deviceScaleFactor: 1 });
    await page.setContent(buildTextBlockHtml({
      ...extracted,
      slide_number: slide.slide_number,
      total_slides: slide.total_slides,
      width: 1080,
      height: textH,
    }), { waitUntil: 'networkidle2', timeout: 10000 });
    const textPngBuf = await page.screenshot({ type: 'png', fullPage: false });
    await page.close();
    fs.writeFileSync(textPngPath, textPngBuf);

    // ── 6. FFmpeg: [text block 380px] + [footage 970px filled, no black bars] = 1080×1350
    // If vtp > 0: crop out competitor's text region first, then fill 970px
    // If vtp = 0: video is pure footage, just fill 970px
    const vidCropFilter = cropY > 20
      ? `[1:v]crop=${vidW}:${cropH}:0:${cropY},scale=1080:${videoH}:force_original_aspect_ratio=increase,crop=1080:${videoH},setsar=1[vid]`
      : `[1:v]scale=1080:${videoH}:force_original_aspect_ratio=increase,crop=1080:${videoH},setsar=1[vid]`;

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(textPngPath)
        .inputOptions(['-loop 1'])
        .input(videoPath)
        .complexFilter([
          `[0:v]scale=1080:${textH},setsar=1[txt]`,
          vidCropFilter,
          '[txt][vid]vstack=inputs=2[out]',
        ])
        .outputOptions([
          '-map [out]',
          '-map 1:a?',
          '-t', String(dims.duration),
          '-c:v libx264',
          '-preset ultrafast',
          '-crf 28',
          '-pix_fmt yuv420p',
          '-movflags +faststart',
          '-threads 1',
          '-bufsize 512k',
          '-maxrate 2M',
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // ── 6. Upload to Cloudinary
    const cloudinaryUrl = await uploadVideoToCloudinary(fs.readFileSync(outputPath));
    cleanup();

    return {
      image_url: cloudinaryUrl,
      is_video: true,
      already_cloudinary: true,
      slide_number: slide.slide_number,
      original_caption: slide.original_caption || '',
      post_id: slide.post_id || '',
      source_account: slide.source_account || '',
    };
  } catch (e) {
    cleanup();
    throw e;
  }
}

async function uploadVideoToCloudinary(videoBuffer) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'drg0uit7h';
  const preset = process.env.CLOUDINARY_UPLOAD_PRESET || 'ml_default';
  const formData = new FormData();
  formData.append('file', new Blob([videoBuffer], { type: 'video/mp4' }), 'video.mp4');
  formData.append('upload_preset', preset);
  const resp = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
    method: 'POST',
    body: formData,
  });
  const data = await resp.json();
  if (!data.secure_url) throw new Error(`Cloudinary video upload failed: ${JSON.stringify(data.error || data)}`);
  return data.secure_url;
}

async function fetchPexelsImage(query, apiKey) {
  try {
    const resp = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=square`,
      { headers: { Authorization: apiKey } }
    );
    const data = await resp.json();
    const photo = data.photos?.[0];
    if (!photo) return null;
    const imgUrl = photo.src.large2x || photo.src.large || photo.src.original;
    const imgResp = await fetch(imgUrl);
    if (!imgResp.ok) return null;
    return Buffer.from(await imgResp.arrayBuffer()).toString('base64');
  } catch (e) {
    console.error('Pexels fetch error:', e.message);
    return null;
  }
}

function buildTextBlockHtml({ headline, subheadline, body, bullets, slide_number = 1, total_slides = 1, width = 1080, height = 380 }) {
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const counter = `${slide_number}/${total_slides}`;
  const hlText = headline || '';
  const hlSize = hlText.length > 80 ? 34 : hlText.length > 60 ? 40 : hlText.length > 40 ? 46 : hlText.length > 20 ? 52 : 58;
  const hasBullets = Array.isArray(bullets) && bullets.length > 0;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${width}px; height:${height}px; background:#07080f; overflow:hidden; font-family:system-ui,-apple-system,Arial,sans-serif; color:#fff; }
  .grid { position:absolute; inset:0; background-image:linear-gradient(rgba(108,99,255,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(108,99,255,0.06) 1px,transparent 1px); background-size:54px 54px; }
  .topbar { position:absolute; top:0; left:0; right:0; height:4px; background:linear-gradient(90deg,#6c63ff,#00d4ff,#6c63ff); }
  .bottombar { position:absolute; bottom:0; left:0; right:0; height:3px; background:linear-gradient(90deg,#6c63ff,#00d4ff); }
  .header { position:absolute; top:18px; left:36px; right:36px; display:flex; align-items:center; justify-content:space-between; }
  .logo { font-size:24px; font-weight:900; letter-spacing:-0.04em; }
  .logo .aima { color:#fff; } .logo .boost { color:#6c63ff; }
  .counter { font-size:14px; font-weight:700; color:rgba(255,255,255,0.35); letter-spacing:0.08em; }
  .content { position:absolute; top:64px; left:36px; right:36px; bottom:16px; display:flex; flex-direction:column; justify-content:center; gap:14px; }
  .accent { width:44px; height:4px; background:linear-gradient(90deg,#6c63ff,#00d4ff); border-radius:2px; }
  .hl { font-family:'Bebas Neue','Oswald',Impact,Arial,sans-serif; font-size:${hlSize}px; font-weight:400; line-height:1.05; letter-spacing:0.5px; text-transform:uppercase; color:#fff; }
  .sub { font-size:20px; font-weight:600; color:#6c63ff; line-height:1.4; }
  .body-text { font-size:20px; font-weight:500; color:rgba(255,255,255,0.90); line-height:1.6; }
  .bullets { list-style:none; display:flex; flex-direction:column; gap:10px; }
  .bullets li { display:flex; align-items:flex-start; gap:12px; font-size:20px; font-weight:500; color:#fff; line-height:1.4; }
  .bullets li::before { content:''; display:block; min-width:9px; height:9px; border-radius:50%; background:#6c63ff; margin-top:6px; flex-shrink:0; }
</style></head><body>
  <div class="grid"></div>
  <div class="topbar"></div>
  <div class="bottombar"></div>
  <div class="header">
    <div class="logo"><span class="aima">AIMA</span><span class="boost">BOOSTING</span></div>
    <div class="counter">${esc(counter)}</div>
  </div>
  <div class="content">
    <div class="accent"></div>
    ${headline ? `<h2 class="hl">${esc(headline)}</h2>` : ''}
    ${subheadline ? `<p class="sub">${esc(subheadline)}</p>` : ''}
    ${hasBullets ? `<ul class="bullets">${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    ${body && !hasBullets ? `<p class="body-text">${esc(body)}</p>` : ''}
  </div>
</body></html>`;
}


async function extractSlideContent(base64Image, openaiKey) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze this Instagram carousel slide. Extract ALL text content and determine layout.

Return ONLY valid JSON (no markdown) with these fields:
- slide_type: "cover" | "content" | "text"
  * "cover" = first/intro slide (usually has a big title + striking visual)
  * "content" = content slide with text/bullets/prompts
  * "text" = stat, quote, or minimal-text-only slide
- has_image: true if the slide contains a significant photo, illustration, or visual element (NOT just text on a flat/dark background); false if the slide is purely text on a solid/dark background
- layout: where the TEXT/BRANDING block is located relative to the visual content: "text_top" (text above, visual below), "text_bottom" (visual above, text below), "text_full" (text throughout, no clear visual area), "visual_full" (mostly visual, minimal text)
- headline: main title or heading (string or null)
- subheadline: secondary heading (string or null)
- body: the COMPLETE body text, WORD FOR WORD — do NOT summarize, truncate, or shorten. Copy every word exactly. (string or null)
- bullets: array of bullet/list items if present, each item COMPLETE (array or null)
- stat_number: prominent number or percentage (string or null)
- stat_label: label for the stat (string or null)
- visual_top_pct: decimal 0.0-1.0 indicating where the visual/video content region starts from the top of the frame.
  Use 0.0 if the visual fills the whole frame (no text block above it).
  Use ~0.33 if there is a text/branding block in the top ~33% and the visual is in the remaining lower portion.
  Use null only if layout is "text_full" (no visual area at all).

RULES:
1. Extract body/bullets text COMPLETELY — include the full prompt, all sentences, every word
2. Ignore account logos, handles, watermarks — only extract informational content
3. Translate all extracted text to Spanish
4. For body text that is a prompt in quotes: keep it as a single body string, translated`,
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'high' },
          },
        ],
      }],
    }),
  });
  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(clean);
}

// buildSlideFromContent: Instagram-style AIMABOOSTING slides.
// Layout:
//   cover  + image → full-bleed photo, dark gradient bottom, big Bebas Neue text w/ teal highlights
//   cover  + no image → black bg, centered big text
//   content + image → black top half (text) + sharp photo bottom half (no blur)
//   content/text + no image → black bg, bold headline + body/bullets
function buildSlideFromContent(data) {
  const {
    slide_type = 'text',
    has_image = false,
    headline, subheadline, body, bullets,
    slide_number = 1, total_slides = 1,
    imageUrl = null,
  } = data;

  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const counter = `${slide_number}/${total_slides}`;
  const hasBullets = Array.isArray(bullets) && bullets.length > 0;
  const hlText = headline || '';

  // Split headline: first half white, second half teal (IG impact style)
  function splitHeadline(text) {
    if (!text) return '';
    const safe = esc(text);
    const words = safe.split(' ');
    if (words.length <= 3) return `<span class="hl-teal">${safe}</span>`;
    const split = Math.ceil(words.length * 0.42);
    const white = words.slice(0, split).join(' ');
    const teal = words.slice(split).join(' ');
    return `${white} <span class="hl-teal">${teal}</span>`;
  }

  // Font sizes
  const coverHlSize = hlText.length > 80 ? 86 : hlText.length > 60 ? 100 : hlText.length > 40 ? 116 : hlText.length > 20 ? 128 : 138;
  const contentHlSize = hlText.length > 70 ? 52 : hlText.length > 50 ? 60 : hlText.length > 30 ? 68 : 76;
  const bodySize = 28;

  const showSplit = (has_image || false) && !!imageUrl;

  // ── Shared elements ─────────────────────────────────────────────────────────
  const logoBar = `
    <div style="position:absolute;top:0;left:0;right:0;height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 40px;z-index:20;background:linear-gradient(180deg,rgba(0,0,0,0.60) 0%,transparent 100%);">
      <img src="data:image/png;base64,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" style="height:38px;width:auto;object-fit:contain;" />
      <div style="font-size:15px;font-weight:700;color:rgba(255,255,255,0.55);letter-spacing:0.08em;">${esc(counter)}</div>
    </div>`;

  const logoBarDark = `
    <div style="position:absolute;top:0;left:0;right:0;height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 40px;z-index:20;">
      <img src="data:image/png;base64,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" style="height:38px;width:auto;object-fit:contain;" />
      <div style="font-size:15px;font-weight:700;color:rgba(255,255,255,0.40);letter-spacing:0.08em;">${esc(counter)}</div>
    </div>`;

  const baseFont = `@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@500;600;700;900&display=swap');`;

  // ── COVER with image ────────────────────────────────────────────────────────
  if (slide_type === 'cover' && imageUrl) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  ${baseFont}
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1080px; height:1350px; overflow:hidden; background:#000; font-family:'Inter',system-ui,Arial,sans-serif; }
  .photo {
    position:absolute; inset:0;
    background-image:url('${imageUrl}');
    background-size:cover; background-position:center;
    filter:brightness(0.9) saturate(1.1);
  }
  .grad {
    position:absolute; inset:0;
    background:linear-gradient(180deg,
      rgba(0,0,0,0.30) 0%,
      rgba(0,0,0,0.00) 20%,
      rgba(0,0,0,0.00) 40%,
      rgba(0,0,0,0.60) 60%,
      rgba(0,0,0,0.95) 78%,
      rgba(0,0,0,1.00) 100%
    );
  }
  .bottom-block {
    position:absolute; bottom:0; left:0; right:0;
    padding:12px 44px 90px;
    display:flex; flex-direction:column; gap:14px; z-index:10;
  }
  .sep { width:60px; height:5px; background:linear-gradient(90deg,#00d4ff,#6c63ff); border-radius:3px; }
  .cover-hl {
    font-family:'Bebas Neue',Impact,Arial,sans-serif;
    font-size:${coverHlSize}px; font-weight:400; line-height:0.93;
    text-transform:uppercase; letter-spacing:2px; color:#fff;
    text-shadow:0 3px 20px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,1);
    word-break:break-word;
  }
  .hl-teal { color:#00d4ff; }
  .swipe-btn {
    display:inline-flex; align-items:center; gap:10px;
    border:2px solid rgba(255,255,255,0.35); border-radius:50px;
    padding:10px 24px; width:fit-content;
    font-size:16px; font-weight:700; color:rgba(255,255,255,0.80); letter-spacing:0.08em;
  }
</style></head><body>
  <div class="photo"></div>
  <div class="grad"></div>
  ${logoBar}
  <div class="bottom-block">
    <div class="sep"></div>
    ${headline ? `<h1 class="cover-hl">${splitHeadline(headline)}</h1>` : ''}
    <div class="swipe-btn">DESLIZA PARA VER MÁS &nbsp;›</div>
  </div>
</body></html>`;
  }

  // ── COVER without image ─────────────────────────────────────────────────────
  if (slide_type === 'cover') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  ${baseFont}
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1080px; height:1350px; overflow:hidden; background:#000; font-family:'Inter',system-ui,Arial,sans-serif; }
  .noise {
    position:absolute; inset:0;
    background:radial-gradient(ellipse 80% 60% at 50% 40%, rgba(0,212,255,0.06) 0%, transparent 70%),
               radial-gradient(ellipse 60% 80% at 80% 80%, rgba(108,99,255,0.07) 0%, transparent 70%),
               #000;
  }
  .cover-area {
    position:absolute; top:100px; left:52px; right:52px; bottom:80px;
    display:flex; flex-direction:column; justify-content:center; gap:24px;
  }
  .handle { font-size:16px; font-weight:700; color:#00d4ff; letter-spacing:0.16em; text-transform:uppercase; }
  .sep { width:64px; height:5px; background:linear-gradient(90deg,#00d4ff,#6c63ff); border-radius:3px; }
  .cover-hl {
    font-family:'Bebas Neue',Impact,Arial,sans-serif;
    font-size:${coverHlSize}px; font-weight:400; line-height:0.93;
    text-transform:uppercase; letter-spacing:2px; color:#fff;
    word-break:break-word;
  }
  .hl-teal { color:#00d4ff; }
  .cover-body { font-size:24px; font-weight:500; color:rgba(255,255,255,0.75); line-height:1.6; }
  .swipe-btn {
    display:inline-flex; align-items:center; gap:10px;
    border:2px solid rgba(255,255,255,0.25); border-radius:50px;
    padding:10px 24px; width:fit-content;
    font-size:16px; font-weight:700; color:rgba(255,255,255,0.65); letter-spacing:0.08em;
  }
</style></head><body>
  <div class="noise"></div>
  ${logoBarDark}
  <div class="cover-area">
    <div class="handle">@aimaboosting</div>
    <div class="sep"></div>
    ${headline ? `<h1 class="cover-hl">${splitHeadline(headline)}</h1>` : ''}
    ${body ? `<p class="cover-body">${esc(body)}</p>` : ''}
    <div class="swipe-btn">DESLIZA PARA VER MÁS &nbsp;›</div>
  </div>
</body></html>`;
  }

  // ── CONTENT with image: full-bleed photo + gradient overlay (magazine style) ──
  if ((slide_type === 'content') && showSplit) {
    const bulletsHtml = hasBullets
      ? `<ul style="list-style:none;display:flex;flex-direction:column;gap:16px;">${bullets.map(b =>
          `<li style="display:flex;align-items:flex-start;gap:14px;font-size:${bodySize}px;font-weight:500;color:rgba(255,255,255,0.92);line-height:1.5;">
            <span style="display:block;min-width:9px;height:9px;border-radius:50%;background:#00d4ff;margin-top:10px;flex-shrink:0;box-shadow:0 0 8px rgba(0,212,255,0.6);"></span>
            ${esc(b)}</li>`
        ).join('')}</ul>`
      : '';
    const bodyHtml = body && !hasBullets
      ? `<p style="font-size:${bodySize}px;font-weight:500;color:rgba(255,255,255,0.88);line-height:1.65;">${esc(body)}</p>`
      : '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  ${baseFont}
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1080px; height:1350px; overflow:hidden; background:#000; font-family:'Inter',system-ui,Arial,sans-serif; }
  .photo {
    position:absolute; inset:0;
    background-image:url('${imageUrl}');
    background-size:cover; background-position:center center;
    filter:brightness(0.75) saturate(1.1);
  }
  /* Top-heavy gradient: solid black top ~40% fading smoothly to transparent */
  .grad {
    position:absolute; inset:0;
    background:linear-gradient(180deg,
      rgba(0,0,0,1.00)  0%,
      rgba(0,0,0,0.98) 25%,
      rgba(0,0,0,0.80) 42%,
      rgba(0,0,0,0.30) 62%,
      rgba(0,0,0,0.08) 80%,
      rgba(0,0,0,0.00) 100%
    );
  }
  /* Bottom vignette so brand pill is readable */
  .grad-bottom {
    position:absolute; inset:0;
    background:linear-gradient(0deg, rgba(0,0,0,0.55) 0%, transparent 15%);
  }
  .text-block {
    position:absolute; top:80px; left:0; right:0;
    padding:24px 48px 0;
    display:flex; flex-direction:column; gap:20px;
  }
  .sep { width:52px; height:5px; background:linear-gradient(90deg,#00d4ff,#6c63ff); border-radius:3px; flex-shrink:0; }
  .content-hl {
    font-family:'Bebas Neue',Impact,Arial,sans-serif;
    font-size:${contentHlSize}px; font-weight:400; line-height:0.95;
    text-transform:uppercase; letter-spacing:1.5px; color:#fff;
    word-break:break-word;
  }
  .brand-bottom {
    position:absolute; bottom:22px; left:0; right:0;
    display:flex; justify-content:center; align-items:center; z-index:10;
  }
  .brand-pill {
    background:rgba(0,0,0,0.80); border:1.5px solid rgba(255,255,255,0.18);
    border-radius:50px; padding:8px 24px;
    font-size:18px; font-weight:900; letter-spacing:-0.02em; color:#fff;
    backdrop-filter:blur(6px);
  }
  .brand-pill span { color:#00d4ff; }
</style></head><body>
  <div class="photo"></div>
  <div class="grad"></div>
  <div class="grad-bottom"></div>
  ${logoBar}
  <div class="text-block">
    <div class="sep"></div>
    ${headline ? `<h2 class="content-hl">${esc(headline)}</h2>` : ''}
    ${bulletsHtml}${bodyHtml}
  </div>
  <div class="brand-bottom">
    <img src="data:image/png;base64,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" style="height:28px;width:auto;object-fit:contain;" />
  </div>
</body></html>`;
  }

  // ── TEXT / BULLETS (no image) ───────────────────────────────────────────────
  const bulletsHtml = hasBullets
    ? `<ul style="list-style:none;display:flex;flex-direction:column;gap:20px;">${bullets.map(b =>
        `<li style="display:flex;align-items:flex-start;gap:16px;font-size:${bodySize}px;font-weight:500;color:#fff;line-height:1.45;">
          <span style="display:block;min-width:10px;height:10px;border-radius:50%;background:#00d4ff;box-shadow:0 0 8px rgba(0,212,255,0.7);margin-top:9px;flex-shrink:0;"></span>
          ${esc(b)}</li>`
      ).join('')}</ul>`
    : '';
  const bodyHtml2 = body && !hasBullets
    ? `<p style="font-size:${bodySize}px;font-weight:500;color:rgba(255,255,255,0.85);line-height:1.65;">${esc(body)}</p>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  ${baseFont}
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1080px; height:1350px; overflow:hidden; background:#000; font-family:'Inter',system-ui,Arial,sans-serif; }
  .noise {
    position:absolute; inset:0;
    background:radial-gradient(ellipse 70% 50% at 50% 30%, rgba(0,212,255,0.05) 0%, transparent 70%), #000;
  }
  .text-area {
    position:absolute; top:100px; left:52px; right:52px; bottom:80px;
    display:flex; flex-direction:column; justify-content:center; gap:22px;
  }
  .sep { width:52px; height:5px; background:linear-gradient(90deg,#00d4ff,#6c63ff); border-radius:3px; flex-shrink:0; }
  .text-hl {
    font-family:'Bebas Neue',Impact,Arial,sans-serif;
    font-size:${contentHlSize}px; font-weight:400; line-height:0.95;
    text-transform:uppercase; letter-spacing:1.5px; color:#fff;
    word-break:break-word;
  }
</style></head><body>
  <div class="noise"></div>
  ${logoBarDark}
  <div class="text-area">
    <div class="sep"></div>
    ${headline ? `<h2 class="text-hl">${esc(headline)}</h2>` : ''}
    ${bulletsHtml}${bodyHtml2}
  </div>
</body></html>`;
}

function buildRebrandHtml(slideImageUrl, slideNumber, totalSlides) {
  const safe = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const numStr = `${slideNumber}/${totalSlides}`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1080px; overflow: hidden; background: #07080f; }

  .bg {
    position: absolute;
    width: 100%; height: 100%;
    object-fit: cover;
    object-position: center center;
  }

  .overlay-top {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 130px;
    background: linear-gradient(to bottom, rgba(7,8,15,0.55) 0%, rgba(7,8,15,0) 100%);
  }

  .brand-bar {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 88px;
    background: linear-gradient(135deg, #07080f 0%, #0d0e1f 40%, #1a1040 100%);
    border-top: 2px solid rgba(108,99,255,0.6);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 32px;
  }

  .brand-logo {
    font-family: system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-weight: 800;
    font-size: 34px;
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .brand-logo .aima { color: #ffffff; }
  .brand-logo .boosting { color: #6c63ff; }

  .brand-tagline {
    font-family: system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-size: 15px;
    font-weight: 600;
    color: rgba(255,255,255,0.45);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .badge {
    position: absolute;
    top: 20px;
    right: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(7,8,15,0.72);
    border: 1px solid rgba(108,99,255,0.55);
    border-radius: 50px;
    padding: 8px 16px;
    backdrop-filter: blur(6px);
  }

  .badge-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #6c63ff;
    box-shadow: 0 0 8px #6c63ff;
  }

  .badge-counter {
    font-family: system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: rgba(255,255,255,0.9);
    letter-spacing: 0.05em;
  }
</style>
</head>
<body>
  <img class="bg" src="${safe(slideImageUrl)}" crossorigin="anonymous">
  <div class="overlay-top"></div>
  <div class="badge">
    <div class="badge-dot"></div>
    <div class="badge-counter">${safe(numStr)}</div>
  </div>
  <div class="brand-bar">
    <div class="brand-logo"><span class="aima">AIMA</span><span class="boosting">BOOSTING</span></div>
    <div class="brand-tagline">Automatización con IA</div>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /render-generate-batch
// Generates AIMABOOSTING slides from pre-generated GPT content + Pexels media.
// No GPT Vision needed — content already structured by n8n before calling.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/render-generate-batch', async (req, res) => {
  const { slides } = req.body;
  if (!Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: 'Missing required field: slides (array)' });
  }
  if (!process.env.IMGBB_API_KEY) return res.status(500).json({ error: 'IMGBB_API_KEY not set' });

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const results = [];
    for (const slide of slides) {
      try {
        const result = await handleGeneratedSlide(slide, browser);
        results.push(result);
      } catch (e) {
        console.error(`[generate-batch] slide ${slide.slide_number} error:`, e.message);
        // Fallback: render pure text slide
        try {
          const pg = await browser.newPage();
          await pg.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
          await pg.setContent(buildAimaCarouselSlide({
            imageUrl: null,
            headline: slide.headline || null,
            body: slide.body || null,
            bullets: slide.bullets || null,
            slide_number: slide.slide_number || 1,
            total_slides: slide.total_slides || slides.length,
            slide_type: 'text',
          }), { waitUntil: 'networkidle2', timeout: 15000 });
          const buf = await pg.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
          await pg.close();
          const url = await uploadToImgbb(buf, process.env.IMGBB_API_KEY);
          results.push({ image_url: url, is_video: false, slide_number: slide.slide_number || 1 });
        } catch (fe) {
          console.error(`[generate-batch] fallback slide ${slide.slide_number} error:`, fe.message);
          results.push({ image_url: null, is_video: false, slide_number: slide.slide_number || 1 });
        }
      }
    }

    await browser.close();
    browser = null;
    res.json({ success: true, images: results });
  } catch (err) {
    console.error('[generate-batch] fatal error:', err.message);
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

// Fetch image from Pexels — photoIndex ensures each slide gets a different photo
async function fetchPexelsImageUrl(query, photoIndex = 0) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch(
      'https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) + '&per_page=15&orientation=portrait',
      { headers: { Authorization: key } }
    );
    const data = await resp.json();
    const photos = data.photos || [];
    if (!photos.length) return null;
    // Pick by index (mod to avoid out-of-bounds)
    const photo = photos[photoIndex % photos.length];
    return photo.src.large2x || photo.src.large || photo.src.original;
  } catch (e) {
    console.error('[pexels] search failed:', e.message);
    return null;
  }
}

// Fetch Pexels video URL by keyword query
async function fetchPexelsVideoUrl(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch(
      'https://api.pexels.com/videos/search?query=' + encodeURIComponent(query) + '&per_page=5&size=medium',
      { headers: { Authorization: key } }
    );
    const data = await resp.json();
    const video = data.videos && data.videos[0];
    if (!video) return null;
    const files = video.video_files || [];
    const hd = files.find(f => f.quality === 'hd' && f.file_type === 'video/mp4')
      || files.find(f => f.file_type === 'video/mp4')
      || files[0];
    return hd ? hd.link : null;
  } catch (e) {
    console.error('[pexels] video search failed:', e.message);
    return null;
  }
}

// Download image URL → base64 data URL for Puppeteer
async function downloadImageAsDataUrl(url) {
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer()).toString('base64');
    return `data:image/jpeg;base64,${buf}`;
  } catch (e) {
    console.error('[img-download] failed:', e.message);
    return null;
  }
}

async function handleGeneratedSlide(slide, browser) {
  const {
    slide_type, headline, subheadline, body, bullets,
    image_base64, video_url,
    slide_number = 1, total_slides = 1,
  } = slide;

  // Use GPT-provided English Pexels query, or fall back to headline words
  const pexelsQuery = slide.pexels_query || (headline || '').replace(/[^\w\s]/g, ' ').split(/\s+/).slice(0, 5).join(' ') || 'technology artificial intelligence';
  console.log(`[generate] slide ${slide_number} pexels_query="${pexelsQuery}"`);

  // Prefer pre-supplied URL, then fetch from Pexels directly on Railway
  let image_url_raw = slide.image_url || null;

  console.log(`[generate] slide ${slide_number} type=${slide_type} pre_url=${!!image_url_raw} b64=${!!image_base64} video=${!!video_url}`);

  // VIDEO slide
  if (slide_type === 'video') {
    // Use pre-supplied video URL or fetch from Pexels
    if (!video_url) {
      slide = Object.assign({}, slide, { video_url: await fetchPexelsVideoUrl(pexelsQuery) });
    }
    if (slide.video_url) {
      return await renderPexelsVideoSlide({ slide, browser });
    }
  }

  // COVER or CONTENT: need an image
  if (slide_type === 'cover' || slide_type === 'content') {
    let imageUrl = null;

    // 1. Try pre-supplied URL
    if (image_url_raw) {
      imageUrl = await downloadImageAsDataUrl(image_url_raw);
    }
    // 2. Fetch from Pexels directly on Railway (use slide_number as index to avoid duplicates)
    if (!imageUrl) {
      const pexelsUrl = await fetchPexelsImageUrl(pexelsQuery, slide_number - 1);
      console.log(`[generate] slide ${slide_number} pexels: ${pexelsUrl}`);
      if (pexelsUrl) imageUrl = await downloadImageAsDataUrl(pexelsUrl);
    }
    // 3. base64 fallback
    if (!imageUrl && image_base64) {
      imageUrl = `data:image/jpeg;base64,${image_base64}`;
    }

    if (imageUrl) {
      const pg = await browser.newPage();
      await pg.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
      await pg.setContent(buildAimaCarouselSlide({
        imageUrl, headline, body, bullets, slide_number, total_slides, slide_type,
      }), { waitUntil: 'networkidle2', timeout: 15000 });
      const buf = await pg.screenshot({ type: 'jpeg', quality: 87, fullPage: false });
      await pg.close();
      const url = await uploadToImgbb(buf, process.env.IMGBB_API_KEY);
      return { image_url: url, is_video: false, slide_number };
    }
  }

  // TEXT slide (or any slide missing media): dark layout
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
  await pg.setContent(buildAimaCarouselSlide({
    imageUrl: null, headline, body, bullets, slide_number, total_slides, slide_type: 'text',
  }), { waitUntil: 'networkidle2', timeout: 15000 });
  const buf = await pg.screenshot({ type: 'jpeg', quality: 87, fullPage: false });
  await pg.close();
  const url = await uploadToImgbb(buf, process.env.IMGBB_API_KEY);
  return { image_url: url, is_video: false, slide_number };
}

async function renderPexelsVideoSlide({ slide, browser }) {
  const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const videoPath  = path.join(os.tmpdir(), `pvid_${tag}.mp4`);
  const textPath   = path.join(os.tmpdir(), `ptxt_${tag}.png`);
  const outputPath = path.join(os.tmpdir(), `pout_${tag}.mp4`);
  const cleanup = () => [videoPath, textPath, outputPath].forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
  });

  try {
    // 1. Download Pexels video
    console.log(`[pexels-video] downloading: ${slide.video_url}`);
    const vr = await fetch(slide.video_url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!vr.ok) throw new Error(`Pexels video download failed: ${vr.status}`);
    fs.writeFileSync(videoPath, Buffer.from(await vr.arrayBuffer()));

    // 2. Get video duration
    const { duration } = await new Promise(resolve => {
      ffmpeg.ffprobe(videoPath, (err, meta) => {
        if (err) return resolve({ duration: 15 });
        resolve({ duration: Math.min(meta.format?.duration || 15, 60) });
      });
    });
    console.log(`[pexels-video] duration=${duration}s`);

    // 3. Render AIMABOOSTING text block (380px tall)
    const textH = 380;
    const pg = await browser.newPage();
    await pg.setViewport({ width: 1080, height: textH, deviceScaleFactor: 1 });
    await pg.setContent(buildTextBlockHtml({
      headline: slide.headline,
      subheadline: slide.subheadline,
      body: slide.body,
      bullets: slide.bullets,
      slide_number: slide.slide_number,
      total_slides: slide.total_slides,
      width: 1080,
      height: textH,
    }), { waitUntil: 'networkidle2', timeout: 10000 });
    const textPng = await pg.screenshot({ type: 'png', fullPage: false });
    await pg.close();
    fs.writeFileSync(textPath, textPng);

    // 4. FFmpeg: text block (380px) stacked above video (970px) = 1080×1350 (4:5)
    const videoH = 970;
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(textPath).inputOptions(['-loop 1'])
        .input(videoPath)
        .complexFilter([
          `[0:v]scale=1080:${textH},setsar=1[txt]`,
          `[1:v]scale=1080:${videoH}:force_original_aspect_ratio=increase,crop=1080:${videoH},setsar=1[vid]`,
          '[txt][vid]vstack=inputs=2[out]',
        ])
        .outputOptions([
          '-map [out]',
          '-map 1:a?',
          '-t', String(duration),
          '-c:v libx264',
          '-preset ultrafast',
          '-crf 28',
          '-pix_fmt yuv420p',
          '-movflags +faststart',
          '-threads 1',
          '-bufsize 512k',
          '-maxrate 2M',
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // 5. Upload to Cloudinary
    const cloudUrl = await uploadVideoToCloudinary(fs.readFileSync(outputPath));
    cleanup();
    console.log(`[pexels-video] done: ${cloudUrl}`);
    return {
      image_url: cloudUrl,
      is_video: true,
      already_cloudinary: true,
      slide_number: slide.slide_number,
    };
  } catch (e) {
    cleanup();
    throw e;
  }
}

// ── AIMABOOSTING Cover-style slide builder ─────────────────────────────────
// All slides: full-bleed photo + gradient overlay + logo top-left + text bottom
// Same visual style as @backpainlife carousel but with AIMABOOSTING branding
let AIMA_LOGO_CYAN_B64 = '';
try { AIMA_LOGO_CYAN_B64 = require('./aima_logo_cyan'); } catch(e) { console.warn('Logo not found:', e.message); }

function buildAimaCarouselSlide({ imageUrl, headline, body, bullets, slide_number, total_slides, slide_type }) {
  const safe = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const parseHl = text => safe(text).replace(/\[\[(.+?)\]\]/g, '<span class="kw">$1</span>');

  const logoSrc = AIMA_LOGO_CYAN_B64
    ? `data:image/png;base64,${AIMA_LOGO_CYAN_B64}`
    : '';
  const logoHtml = logoSrc
    ? `<img class="logo" src="${logoSrc}" alt="AIMABOOSTING">`
    : `<div class="logo-text">AIMA<span>BOOSTING</span></div>`;

  const counter = `${slide_number}/${total_slides}`;
  const isCover = slide_number === 1 || slide_type === 'cover';
  const hasBullets = Array.isArray(bullets) && bullets.length > 0;

  const fonts = `@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;900&display=swap');`;

  // TEXT slide (no photo) — dark background
  if (slide_type === 'text' || !imageUrl) {
    const hlSize = (headline || '').length > 60 ? 52 : (headline || '').length > 40 ? 62 : 72;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  ${fonts}
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1080px; height:1350px; overflow:hidden; background:#08090f; font-family:'Montserrat',Arial,sans-serif; }
  .topbar { position:absolute; top:0; left:0; right:0; height:5px; background:linear-gradient(90deg,#00c8ff,#0070ff,#00c8ff); }
  .counter { position:absolute; top:28px; right:36px; color:rgba(255,255,255,0.35); font-size:22px; font-weight:700; letter-spacing:0.06em; }
  .logo { position:absolute; top:20px; left:36px; height:52px; width:auto; }
  .logo-text { position:absolute; top:20px; left:36px; color:#fff; font-size:28px; font-weight:900; letter-spacing:-0.02em; }
  .logo-text span { color:#00c8ff; }
  .content { position:absolute; top:120px; left:60px; right:60px; bottom:80px; display:flex; flex-direction:column; justify-content:center; gap:28px; }
  .accent { width:56px; height:5px; background:#00c8ff; border-radius:3px; }
  .hl { color:#fff; font-size:${hlSize}px; font-weight:900; text-transform:uppercase; line-height:1.05; letter-spacing:0.5px; word-break:break-word; }
  .hl .kw { color:#00c8ff; }
  .bullets { list-style:none; display:flex; flex-direction:column; gap:20px; margin-top:8px; }
  .bullets li { display:flex; align-items:flex-start; gap:18px; font-size:34px; font-weight:600; color:rgba(255,255,255,0.92); line-height:1.4; }
  .bullets li::before { content:''; display:block; min-width:10px; height:10px; border-radius:50%; background:#00c8ff; margin-top:12px; flex-shrink:0; }
  .bottombar { position:absolute; bottom:0; left:0; right:0; height:4px; background:linear-gradient(90deg,#00c8ff,#0070ff); }
</style></head><body>
  <div class="topbar"></div>
  <div class="counter">${safe(counter)}</div>
  ${logoHtml}
  <div class="content">
    <div class="accent"></div>
    ${headline ? `<h2 class="hl">${parseHl(headline)}</h2>` : ''}
    ${hasBullets ? `<ul class="bullets">${bullets.map(b => `<li>${safe(b)}</li>`).join('')}</ul>` : ''}
  </div>
  <div class="bottombar"></div>
</body></html>`;
  }

  // PHOTO slide — full-bleed cover style (centered, logo above headline)
  const hlSize = (headline || '').length > 60 ? 64 : (headline || '').length > 40 ? 76 : 88;
  const bodySize = 30;
  const showCounter = total_slides > 1;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  ${fonts}
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1080px; height:1350px; overflow:hidden; background:#000; font-family:'Montserrat',Arial,sans-serif; }
  .bg { position:absolute; width:100%; height:100%; object-fit:cover; opacity:0.92; }
  .overlay { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, transparent 28%, transparent 44%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.93) 76%, #000 90%); }
  .counter { position:absolute; top:28px; right:36px; color:rgba(255,255,255,0.7); font-size:22px; font-weight:700; letter-spacing:0.06em; text-shadow:0 2px 4px rgba(0,0,0,0.9); }
  .text-block { position:absolute; bottom:0; left:0; right:0; padding:0 52px 52px 52px; text-align:center; }
  .logo { height:58px; width:auto; margin-bottom:20px; filter:drop-shadow(0 2px 8px rgba(0,0,0,0.9)); }
  .logo-text { color:#fff; font-size:30px; font-weight:900; letter-spacing:-0.02em; margin-bottom:20px; text-shadow:0 2px 8px rgba(0,0,0,0.9); }
  .logo-text span { color:#00c8ff; }
  .hl { color:#fff; font-size:${hlSize}px; font-weight:900; text-transform:uppercase; line-height:1.0; letter-spacing:1px; word-break:break-word; text-shadow:2px 2px 8px rgba(0,0,0,0.9); }
  .hl .kw { color:#00c8ff; }
  .body-text { margin-top:18px; color:rgba(255,255,255,0.88); font-size:${bodySize}px; font-weight:600; line-height:1.55; text-shadow:1px 1px 4px rgba(0,0,0,0.9); }
  .swipe { display:inline-block; margin-top:22px; color:#00c8ff; font-size:28px; font-weight:900; letter-spacing:4px; text-transform:uppercase; text-shadow:0 2px 4px rgba(0,0,0,0.8); }
</style></head><body>
  <img class="bg" src="${safe(imageUrl)}" crossorigin="anonymous">
  <div class="overlay"></div>
  ${showCounter ? `<div class="counter">${safe(counter)}</div>` : ''}
  <div class="text-block">
    ${logoSrc ? `<img class="logo" src="${logoSrc}" alt="AIMABOOSTING">` : `<div class="logo-text">AIMA<span>BOOSTING</span></div>`}
    <div class="hl">${parseHl(headline || '')}</div>
    ${body && !hasBullets ? `<div class="body-text">${safe(body)}</div>` : ''}
    ${isCover && total_slides > 1 ? '<div class="swipe">DESLIZA →</div>' : ''}
  </div>
</body></html>`;
}

// POST /render-aima — Single image for @aimaboosting (same cover style, no counter/swipe)
app.post('/render-aima', async (req, res) => {
  const { background_url, headline } = req.body;
  if (!background_url || !headline) return res.status(400).json({ error: 'Missing background_url or headline' });
  if (!process.env.IMGBB_API_KEY) return res.status(500).json({ error: 'IMGBB_API_KEY not set' });

  let browser;
  try {
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    const imageDataUrl = await downloadImageAsDataUrl(background_url);
    await page.setContent(buildAimaCarouselSlide({
      imageUrl: imageDataUrl || background_url,
      headline, body: null, bullets: null,
      slide_number: 1, total_slides: 1, slide_type: 'cover',
    }), { waitUntil: 'networkidle2', timeout: 20000 });
    const buffer = await page.screenshot({ type: 'jpeg', quality: 88, fullPage: false });
    await browser.close(); browser = null;
    const imageUrl = await uploadToImgbb(buffer, process.env.IMGBB_API_KEY);
    res.json({ success: true, image_url: imageUrl });
  } catch (err) {
    console.error('[render-aima] error:', err.message);
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// /render-story  — 1080×1920 Stories  (9:16)
// ─────────────────────────────────────────────────────────────
function buildStoryHtml({ story_type, bgDataUri, gradient,
  question, options, correct_index,
  headline, body, cta,
  option_a, option_b, context,
  fact, emoji, source_hint,
  action, benefit }) {

  const safe = s => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const GRADIENTS = {
    midnight_blue: 'linear-gradient(160deg,#0f0c29 0%,#302b63 50%,#24243e 100%)',
    dark_teal:     'linear-gradient(160deg,#134e5e 0%,#1a6b7c 50%,#71b280 100%)',
    deep_purple:   'linear-gradient(160deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)',
    forest_dark:   'linear-gradient(160deg,#0f2027 0%,#203a43 50%,#2c5364 100%)',
    charcoal_warm: 'linear-gradient(160deg,#232526 0%,#414345 100%)',
  };

  const bgCss = bgDataUri
    ? 'background:#000;'
    : `background:${GRADIENTS[gradient] || GRADIENTS.midnight_blue};`;

  // Build card inner HTML per story type
  let cardHtml = '';
  if (story_type === 'quiz') {
    const letters = ['A','B','C','D'];
    const opts = (Array.isArray(options) ? options : []).map((o, i) =>
      `<div class="quiz-opt">${letters[i] || i+1}. ${safe(o)}</div>`
    ).join('');
    cardHtml = `
      <div class="badge">QUIZ 🧠</div>
      <div class="card-question">${safe(question)}</div>
      <div class="quiz-options">${opts}</div>
      <div class="card-cta">Comment your answer below! 👇</div>`;
  } else if (story_type === 'tip') {
    cardHtml = `
      <div class="badge">💡 TIP OF THE DAY</div>
      <div class="card-headline">${safe(headline)}</div>
      <div class="card-body">${safe(body)}</div>
      <div class="card-cta">${safe(cta || 'Save this!')}</div>`;
  } else if (story_type === 'poll') {
    cardHtml = `
      <div class="badge">VOTE BELOW 👇</div>
      <div class="card-question">${safe(question)}</div>
      ${context ? `<div class="card-context">${safe(context)}</div>` : ''}
      <div class="poll-opts">
        <div class="poll-a">${safe(option_a || 'A')}</div>
        <div class="poll-b">${safe(option_b || 'B')}</div>
      </div>
      <div class="card-cta">Comment A or B below!</div>`;
  } else if (story_type === 'didyouknow') {
    cardHtml = `
      <div class="badge">${safe(emoji || '🦴')} DID YOU KNOW?</div>
      <div class="card-fact">${safe(fact)}</div>
      ${source_hint ? `<div class="card-source">${safe(source_hint)}</div>` : ''}`;
  } else if (story_type === 'challenge') {
    cardHtml = `
      <div class="badge">🔥 CHALLENGE</div>
      <div class="card-headline">${safe(headline)}</div>
      <div class="card-body">${safe(action)}</div>
      ${benefit ? `<div class="card-benefit">✅ ${safe(benefit)}</div>` : ''}
      <div class="card-cta">${safe(cta || 'Save this challenge!')}</div>`;
  } else {
    cardHtml = `<div class="card-body">${safe(body || headline || '')}</div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:1080px;height:1920px;overflow:hidden;${bgCss}font-family:'Montserrat',Arial,sans-serif;}
  .bg{position:absolute;width:100%;height:100%;object-fit:cover;opacity:0.72;}
  .overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,0.25) 0%,rgba(0,0,0,0.55) 45%,rgba(0,0,0,0.85) 100%);}
  .handle{position:absolute;top:80px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.92);font-size:34px;font-weight:900;letter-spacing:5px;text-shadow:0 2px 10px rgba(0,0,0,0.8);white-space:nowrap;}
  .card{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:920px;background:rgba(255,255,255,0.97);border-radius:40px;padding:58px 64px;box-shadow:0 20px 80px rgba(0,0,0,0.65);}
  .badge{display:inline-block;background:#4BB8D0;color:#fff;font-size:26px;font-weight:900;letter-spacing:3px;padding:8px 26px;border-radius:30px;margin-bottom:28px;text-transform:uppercase;}
  .card-question{color:#1a1a1a;font-size:36px;font-weight:700;line-height:1.3;margin-bottom:28px;}
  .card-headline{color:#1a1a1a;font-size:40px;font-weight:900;text-transform:uppercase;line-height:1.1;margin-bottom:24px;}
  .card-body{color:#333;font-size:28px;font-weight:600;line-height:1.55;margin-bottom:22px;}
  .card-fact{color:#1a1a1a;font-size:31px;font-weight:700;line-height:1.45;margin-bottom:18px;}
  .card-source{color:#888;font-size:22px;font-style:italic;margin-top:6px;}
  .card-context{color:#555;font-size:26px;margin-bottom:22px;line-height:1.4;}
  .card-cta{color:#4BB8D0;font-size:26px;font-weight:900;letter-spacing:1px;margin-top:10px;}
  .card-benefit{color:#2e7d32;font-size:26px;font-weight:700;margin-bottom:16px;}
  .quiz-options{display:flex;flex-direction:column;gap:14px;margin-bottom:22px;}
  .quiz-opt{background:#f5f5f5;border:2px solid #e0e0e0;border-radius:16px;padding:15px 22px;color:#1a1a1a;font-size:25px;font-weight:600;}
  .poll-opts{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:22px 0;}
  .poll-a,.poll-b{border-radius:20px;padding:26px 16px;text-align:center;font-size:28px;font-weight:900;letter-spacing:2px;}
  .poll-a{background:#4BB8D0;color:#fff;}
  .poll-b{background:#1a1a2e;color:#fff;}
</style>
</head>
<body>
  ${bgDataUri ? `<img class="bg" src="${bgDataUri}">` : ''}
  <div class="overlay"></div>
  <div class="handle">@BACKPAINLIFE</div>
  <div class="card">${cardHtml}</div>
</body>
</html>`;
}

app.post('/render-story', async (req, res) => {
  const { story_type, background_url, gradient } = req.body;
  if (!story_type) return res.status(400).json({ error: 'Missing story_type' });

  const imgbbKey = process.env.IMGBB_API_KEY;
  if (!imgbbKey) return res.status(500).json({ error: 'IMGBB_API_KEY not set' });

  let browser;
  try {
    // Fetch background image as data URI (avoids CORS issues in Puppeteer)
    let bgDataUri = null;
    const bgUrl = background_url || (!gradient && req.body.pexels_query
      ? await fetchPexelsImageUrl(req.body.pexels_query, 0).catch(() => null)
      : null);
    if (bgUrl) {
      try {
        const r = await fetch(bgUrl);
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          const ct = r.headers.get('content-type') || 'image/jpeg';
          bgDataUri = `data:${ct};base64,${buf.toString('base64')}`;
        }
      } catch (e) { console.error('[render-story] BG fetch error:', e.message); }
    }

    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.setContent(
      buildStoryHtml({ ...req.body, bgDataUri }),
      { waitUntil: 'networkidle0', timeout: 25000 }
    );
    const buffer = await page.screenshot({ type: 'jpeg', quality: 90, fullPage: false });
    await browser.close(); browser = null;

    const imageUrl = await uploadToImgbb(buffer, imgbbKey);
    res.json({ success: true, image_url: imageUrl });
  } catch (err) {
    console.error('[render-story] error:', err.message);
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Image renderer running on port ${PORT}`));
