// הגדרות האריזה של JARVIS ל-Windows (electron-builder).
// ב-Windows (CI או מחשב מקומי) עורכים את ה-exe (אייקון ומטא-דאטה). ב-Linux אין Wine, לכן מדלגים.
const editExe = process.platform === 'win32' || process.env.JARVIS_EDIT_EXE === 'true';

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.ori.jarvis',
  productName: 'JARVIS',
  copyright: 'Copyright © 2026 Ori',
  directories: { output: 'release', buildResources: 'build' },
  files: [
    'dist/**/*',
    'package.json',
    '!**/*.map',
    // Porcupine: רק הבינארי והמודלים של Windows (שאר הפלטפורמות לא נדרשות במתקין)
    '!node_modules/@picovoice/porcupine-node/lib/{mac,raspberry-pi,linux}/**',
    '!node_modules/@picovoice/porcupine-node/resources/keyword_files/{mac,raspberry-pi,linux}/**',
  ],
  // הספרייה הנייטיבית של Porcupine קוראת קבצים מהדיסק — חייבים להיות מחוץ ל-app.asar
  asarUnpack: ['node_modules/@picovoice/porcupine-node/**'],
  extraResources: [
    { from: 'resources/', to: 'resources/', filter: ['**/*'] },
    { from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' },
  ],
  asar: true,
  afterPack: 'scripts/after-pack.cjs',
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] },
    ],
    icon: 'build/icon.ico',
    signAndEditExecutable: editExe,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'JARVIS',
    deleteAppDataOnUninstall: false,
    installerLanguages: ['he_IL', 'en_US'],
  },
  linux: { target: ['dir'], category: 'Utility', icon: 'build/icon.png' },
};
