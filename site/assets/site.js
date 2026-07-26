document.documentElement.classList.add('js');

const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function installCopyButtons() {
  document.querySelectorAll('pre.command-block').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code || pre.querySelector('.copy-command')) return;
    const button = document.createElement('button');
    button.className = 'copy-command';
    button.type = 'button';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy command');
    button.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
        await Promise.race([
          navigator.clipboard.writeText(code.textContent.trim()),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Clipboard request timed out')), 800);
          }),
        ]);
        button.textContent = 'Copied';
        button.dataset.copied = 'true';
        setTimeout(() => {
          button.textContent = 'Copy';
          delete button.dataset.copied;
        }, 1800);
      } catch {
        const selection = getSelection();
        const range = document.createRange();
        range.selectNodeContents(code);
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = 'Select text';
      }
    });
    pre.append(button);
  });
}

function visitorPlatform() {
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes('linux') && !agent.includes('android')) return 'linux';
  if (agent.includes('win')) return 'windows';
  return 'windows';
}

function selectPlatform(platform) {
  document.querySelectorAll('[data-platform-tab]').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.platformTab === platform));
  });
  document.querySelectorAll('[data-platform-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.platformPanel !== platform;
  });
  document.querySelectorAll('[data-detected-platform]').forEach((label) => {
    label.textContent = platform === 'windows' ? 'windows_x64' : 'linux_x64';
  });
}

function installPlatformTabs() {
  const tabs = [...document.querySelectorAll('[data-platform-tab]')];
  if (!tabs.length) return;
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => selectPlatform(tab.dataset.platformTab));
  });
  selectPlatform(visitorPlatform());
}

async function typeTerminal() {
  const lines = [...document.querySelectorAll('[data-terminal-line]')];
  if (!lines.length || prefersReducedMotion.matches) return;
  const fullLines = lines.map((line) => line.textContent);
  lines.forEach((line) => { line.textContent = ''; });
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const text = fullLines[lineIndex];
    for (const character of text) {
      line.textContent += character;
      await new Promise((resolve) => setTimeout(resolve, lineIndex === 0 ? 24 : 9));
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function releaseSummary(body) {
  return String(body || '')
    .replace(/\s+by\s+@[a-z0-9-]+(?=\s|$)/gi, ' ')
    .replace(/(^|\s)@[a-z0-9-]+(?=\s|$)/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bFull Changelog\b\s*:?\s*/gi, ' ')
    .replace(/[`#>*_[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 420);
}

async function refreshReleaseMetadata() {
  const nodes = [...document.querySelectorAll('[data-release-version]')];
  const notes = [...document.querySelectorAll('[data-release-notes]')];
  if (!nodes.length && !notes.length) return;
  try {
    const response = await fetch('https://api.github.com/repos/hackerslairhq/desktop/releases?per_page=1', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return;
    const [release] = await response.json();
    if (!release) return;
    if (!/^v\d+\.\d+\.\d+/.test(release.tag_name || '')) return;
    nodes.forEach((node) => { node.textContent = release.tag_name; });
    const summary = releaseSummary(release.body);
    if (summary) notes.forEach((node) => { node.textContent = summary; });
    document.querySelectorAll('[data-release-date]').forEach((node) => {
      node.textContent = new Date(release.published_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    });
  } catch {
    // The static fallback remains visible offline and when GitHub is unavailable.
  }
}

installCopyButtons();
installPlatformTabs();
void typeTerminal();
void refreshReleaseMetadata();
