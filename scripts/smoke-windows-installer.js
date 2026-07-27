#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} exited with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error([
        `${command} exited with ${code}`,
        stdout,
        stderr,
      ].filter(Boolean).join('\n')));
    });
  });
}

function currentProcessIsElevated() {
  return run('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    [
      '$identity = [Security.Principal.WindowsIdentity]::GetCurrent();',
      '$principal = New-Object Security.Principal.WindowsPrincipal($identity);',
      '$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    ].join(' '),
  ]).trim() === 'True';
}

function installedProcessIds(executable) {
  const output = run('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    [
      '$target = [IO.Path]::GetFullPath($env:LAIR_SMOKE_EXECUTABLE);',
      `$ids = Get-CimInstance Win32_Process -Filter "Name='HackersLair.exe'" |`,
      'Where-Object {',
      '$_.ExecutablePath -and',
      '[IO.Path]::GetFullPath($_.ExecutablePath).Equals(',
      '$target, [StringComparison]::OrdinalIgnoreCase',
      ')',
      '} | Select-Object -ExpandProperty ProcessId;',
      '$ids -join ","',
    ].join(' '),
  ], {
    env: {
      ...process.env,
      LAIR_SMOKE_EXECUTABLE: executable,
    },
  }).trim();
  return output ? output.split(',').map(Number) : [];
}

function stopInstalledProcesses(executable) {
  for (const processId of installedProcessIds(executable)) {
    try {
      process.kill(processId);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

async function waitForInstalledProcessesToExit(executable, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (installedProcessIds(executable).length) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${executable} to exit.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('Windows installer smoke skipped on non-Windows host.');
    return;
  }
  const packageRoot = path.join(root, 'out', "Hacker's Lair-win32-x64");
  const executable = path.join(packageRoot, 'HackersLair.exe');
  if (!fs.existsSync(executable)) {
    throw new Error('Run npm run package before the Windows installer smoke.');
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hackers-lair-installer-smoke-'));
  const archiveName = 'hackers-lair-win32-x64.zip';
  const archive = path.join(temporaryRoot, archiveName);
  const checksums = path.join(temporaryRoot, 'checksums.txt');
  const installRoot = path.join(
    process.env.LOCALAPPDATA,
    'Programs',
    `HackersLairSmoke-${process.pid}`,
  );
  const allowedParent = path.resolve(process.env.LOCALAPPDATA, 'Programs');
  if (!path.resolve(installRoot).startsWith(`${allowedParent}${path.sep}`)) {
    throw new Error(`Unsafe smoke install path: ${installRoot}`);
  }

  try {
    run('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
        '[System.IO.Compression.ZipFile]::CreateFromDirectory(',
        '$env:LAIR_SMOKE_SOURCE,',
        '$env:LAIR_SMOKE_ARCHIVE,',
        '[System.IO.Compression.CompressionLevel]::Optimal,',
        '$false)',
      ].join(' '),
    ], {
      env: {
        ...process.env,
        LAIR_SMOKE_SOURCE: packageRoot,
        LAIR_SMOKE_ARCHIVE: archive,
      },
    });
    const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    fs.writeFileSync(checksums, `${hash}  ${archiveName}\n`);

    let releasePayload;
    const server = http.createServer((request, response) => {
      if (request.url === '/release') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(releasePayload));
        return;
      }
      if (request.url === '/release-unavailable') {
        response.statusCode = 429;
        response.end('rate limited');
        return;
      }
      const filename = request.url === `/${archiveName}`
        ? archive
        : request.url === '/checksums.txt'
          ? checksums
          : '';
      if (!filename) {
        response.statusCode = 404;
        response.end('not found');
        return;
      }
      response.setHeader('Content-Type', 'application/octet-stream');
      fs.createReadStream(filename).pipe(response);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    releasePayload = {
      tag_name: `v${require('../package.json').version}`,
      assets: [
        { name: archiveName, browser_download_url: `http://127.0.0.1:${port}/${archiveName}` },
        { name: 'checksums.txt', browser_download_url: `http://127.0.0.1:${port}/checksums.txt` },
      ],
    };
    const releaseBaseUrl = `http://127.0.0.1:${port}`;
    const installerArguments = (releaseApi, { noLaunch = true } = {}) => {
      const args = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'install.ps1'),
        '-InstallDirectory',
        installRoot,
        '-ReleaseApi',
        `${releaseBaseUrl}/${releaseApi}`,
        '-ReleaseDownloadBase',
        releaseBaseUrl,
      ];
      if (noLaunch) args.push('-NoLaunch');
      args.push('-NoStartup', '-NoShortcut', '-NoPath');
      return args;
    };

    try {
      fs.writeFileSync(checksums, `${'0'.repeat(64)}  ${archiveName}\n`);
      let checksumFailure = null;
      try {
        await runAsync('powershell', installerArguments('release'));
      } catch (error) {
        checksumFailure = error;
      }
      if (!checksumFailure || !checksumFailure.message.includes('SHA256 mismatch')) {
        throw new Error('Installer did not reject the deliberately incorrect checksum.');
      }
      if (fs.existsSync(installRoot)) {
        throw new Error('Checksum failure created an installation directory.');
      }

      fs.writeFileSync(checksums, `${hash}  ${archiveName}\n`);
      await runAsync('powershell', installerArguments('release-unavailable'));
      const installedExecutable = path.join(installRoot, 'HackersLair.exe');
      const installedCli = path.join(installRoot, 'resources', 'app.asar', 'bin', 'lair.js');
      if (!fs.existsSync(installedExecutable) || !fs.existsSync(path.join(installRoot, 'lair.cmd'))) {
        throw new Error('Installer did not create the expected executable and CLI shim.');
      }
      const cliOutput = run(installedExecutable, [installedCli, '--help'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      if (!cliOutput.includes("Hacker's Lair CLI")) throw new Error('Installed CLI did not start.');

      const elevatedLaunchFailures = [];
      if (currentProcessIsElevated()) {
        const launchOutput = await runAsync(
          'powershell',
          installerArguments('release-unavailable', { noLaunch: false }),
          {
            env: {
              ...process.env,
              PROJECT_MANAGER_DATA_DIR: path.join(temporaryRoot, 'user-data'),
              LAIR_SMOKE_EXIT_AFTER_MS: '5000',
            },
          },
        );
        if (!launchOutput.includes('Administrator PowerShell detected: automatic launch was skipped.')) {
          elevatedLaunchFailures.push(
            'Elevated installer did not explain that automatic launch was skipped.',
          );
        }
        if (installedProcessIds(installedExecutable).length) {
          elevatedLaunchFailures.push(
            'Elevated installer left an elevated desktop process running.',
          );
        }
        stopInstalledProcesses(installedExecutable);
        await waitForInstalledProcessesToExit(installedExecutable);
      }

      run('powershell', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'uninstall.ps1'),
        '-InstallDirectory',
        installRoot,
        '-KeepData',
        '-NoShortcut',
        '-NoPath',
      ]);
      if (fs.existsSync(installRoot)) throw new Error('Uninstaller left the smoke install directory behind.');
      if (elevatedLaunchFailures.length) {
        throw new Error(elevatedLaunchFailures.join('\n'));
      }
      console.log('Windows checksum installer, packaged CLI, and verified uninstaller smoke passed.');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    const installedExecutable = path.join(installRoot, 'HackersLair.exe');
    if (fs.existsSync(installedExecutable)) stopInstalledProcesses(installedExecutable);
    if (fs.existsSync(installRoot)) {
      fs.rmSync(installRoot, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 250,
      });
    }
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
