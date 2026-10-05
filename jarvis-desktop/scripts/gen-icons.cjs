// מייצר אייקונים (PNG בגדלים שונים) מ-build/icon.svg בעזרת Electron (offscreen).
// הרצה חד-פעמית בפיתוח: npx electron scripts/gen-icons.cjs  ואז ImageMagick ליצירת ICO.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build/icon.svg'), 'utf8');
const sizes = [16, 24, 32, 48, 64, 128, 256];
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  for (const size of sizes) {
    win.setContentSize(size, size);
    const html = `<html><body style="margin:0;background:transparent">${svg.replace('width="256" height="256"', `width="${size}" height="${size}"`)}</body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 300));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    const out = path.join(root, 'build', `icon-${size}.png`);
    fs.writeFileSync(out, img.resize({ width: size, height: size }).toPNG());
    console.log('wrote', out, img.getSize());
  }
  app.quit();
});
