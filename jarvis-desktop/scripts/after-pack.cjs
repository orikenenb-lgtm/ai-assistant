// הקשחת Electron אחרי האריזה (Electron Fuses): מבטל מצבים שמאפשרים להריץ את
// הבינארי כ-Node כללי או להזריק קוד דרך משתני סביבה / דגלי debug.
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const exeName = packager.appInfo.productFilename;
  const ext = { win32: '.exe', darwin: '.app', linux: '' }[electronPlatformName] ?? '';
  const electronBinary =
    electronPlatformName === 'darwin'
      ? path.join(appOutDir, `${exeName}.app`)
      : path.join(appOutDir, electronPlatformName === 'linux' ? packager.executableName : `${exeName}${ext}`);
  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  console.log(`[after-pack] fuses flipped for ${electronBinary}`);
};
