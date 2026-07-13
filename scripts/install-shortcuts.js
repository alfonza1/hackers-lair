const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const {
  APP_NAME,
  APP_USER_MODEL_ID,
  ICON_CACHE_FILENAME,
} = require('../app-config');

const root = path.resolve(__dirname, '..');

app.setName(APP_NAME);
app.setAppUserModelId(APP_USER_MODEL_ID);

function shortcutDetails(shortcutIcon, extraArgument = '') {
  const launcherPath = path.join(root, 'launcher.vbs');
  const arguments = `"${launcherPath}"${extraArgument ? ` ${extraArgument}` : ''}`;

  return {
    target: path.join(process.env.SystemRoot, 'System32', 'wscript.exe'),
    args: arguments,
    cwd: root,
    description: `Open ${APP_NAME} for projects, ports, and local scripts`,
    icon: shortcutIcon,
    iconIndex: 0,
    appUserModelId: APP_USER_MODEL_ID,
  };
}

function createShortcut(shortcutPath, shortcutIcon, extraArgument = '') {
  const created = shell.writeShortcutLink(
    shortcutPath,
    'create',
    shortcutDetails(shortcutIcon, extraArgument),
  );

  if (!created) throw new Error(`Windows rejected shortcut creation: ${shortcutPath}`);
  const installed = shell.readShortcutLink(shortcutPath);
  if (installed.appUserModelId !== APP_USER_MODEL_ID || installed.icon !== shortcutIcon) {
    throw new Error(`Windows saved incomplete shortcut metadata: ${shortcutPath}`);
  }
  console.log(`Created: ${shortcutPath}`);
}

async function installShortcuts() {
  await app.whenReady();

  const iconDirectory = path.join(app.getPath('userData'), 'icons');
  const shortcutIcon = path.join(iconDirectory, ICON_CACHE_FILENAME);
  fs.mkdirSync(iconDirectory, { recursive: true });
  fs.copyFileSync(path.join(root, 'icon.ico'), shortcutIcon);

  const startMenu = path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
  );
  const startup = path.join(startMenu, 'Startup');
  const shortcuts = [
    [path.join(startMenu, `${APP_NAME}.lnk`), ''],
    [path.join(app.getPath('desktop'), `${APP_NAME}.lnk`), ''],
    [path.join(startup, `${APP_NAME}.lnk`), 'boot'],
  ];

  for (const [shortcutPath, extraArgument] of shortcuts) {
    createShortcut(shortcutPath, shortcutIcon, extraArgument);
  }
}

installShortcuts()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error.stack || error.message);
    app.exit(1);
  });
