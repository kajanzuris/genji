import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AUDIO_OFFSET = 0; // detik; positif = audio tertunda
const FPS = 30, W = 720, H = 1280;
const dir = path.dirname(fileURLToPath(import.meta.url));
const fr = path.join(dir, 'frames');
fs.mkdirSync(fr, { recursive: true });
if (!fs.existsSync(path.join(dir, 'narasi.mp3'))) { console.error('narasi.mp3 tidak ada di folder ini.'); process.exit(1); }

const args = process.env.GPU === '1' ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const br = await chromium.launch({ args });
const pg = await br.newPage({ viewport: { width: W, height: H } });
const die = (m) => { console.error('\nERROR: ' + m); process.exit(1); };
pg.on('pageerror', (e) => die('Halaman error: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') console.error('Console:', m.text()); });
await pg.goto(pathToFileURL(path.join(dir, 'index.html')).href + '#r');
try { await pg.waitForFunction(() => typeof window.renderFrame === 'function' && window.DURATION, null, { timeout: 60000 }); }
catch { die('Halaman tidak siap. Pastikan internet aktif (three.js dimuat dari cdnjs).'); }

const dur = await pg.evaluate(() => window.DURATION);
const N = Math.round(dur * FPS), t0 = Date.now();
let done = 0;
for (let i = 0; i < N; i++) {
  const f = path.join(fr, 'f' + String(i).padStart(5, '0') + '.jpg');
  if (process.env.RESUME === '1' && fs.existsSync(f)) continue;
  await pg.evaluate((t) => window.renderFrame(t), i / FPS);
  await pg.screenshot({ path: f, type: 'jpeg', quality: 95 });
  done++;
  const el = (Date.now() - t0) / 1000, eta = Math.round((el / done) * (N - i - 1));
  process.stdout.write(`\rFrame ${i + 1}/${N} | sisa ~${Math.floor(eta / 60)}m ${eta % 60}s   `);
}
console.log('\nMembuat SFX...');
const b64 = await pg.evaluate(() => window.renderSfx());
fs.writeFileSync(path.join(dir, 'sfx.wav'), Buffer.from(b64, 'base64'));
await br.close();

const ms = Math.round(AUDIO_OFFSET * 1000);
const af = ms >= 0 ? `adelay=${ms}|${ms}` : `atrim=start=${-AUDIO_OFFSET},asetpts=PTS-STARTPTS`;
const ff = spawn('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(fr, 'f%05d.jpg'), '-i', path.join(dir, 'narasi.mp3'), '-i', path.join(dir, 'sfx.wav'),
  '-filter_complex', `[1:a]${af}[n];[2:a]volume=0.5[s];[n][s]amix=inputs=2:normalize=0:duration=longest[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'video.mp4')], { stdio: 'inherit' });
ff.on('error', () => die('FFmpeg tidak ditemukan. Pasang FFmpeg dan buka ulang terminal.'));
ff.on('close', (c) => { if (c === 0) console.log('Selesai: video.mp4'); else die('FFmpeg gagal (kode ' + c + ')'); });
