const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function defaultRunGit(args) {
  return execFileAsync('git', args, {
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  });
}

async function skillsRepoStatus(skillsDirectory, { runGit = defaultRunGit } = {}) {
  try {
    const root = (await runGit(['-C', skillsDirectory, 'rev-parse', '--show-toplevel'])).stdout.trim();
    const status = (await runGit(['-C', root, 'status', '--porcelain'])).stdout;
    let unpushedCommits = 0;
    try {
      const output = await runGit(['-C', root, 'rev-list', '--count', '@{upstream}..HEAD']);
      unpushedCommits = Number.parseInt(output.stdout.trim(), 10) || 0;
    } catch {
      // A repository without an upstream has no comparable unpublished count.
    }
    return {
      available: true,
      root,
      dirtyFiles: status.split(/\r?\n/).filter(Boolean).length,
      unpushedCommits,
      error: '',
    };
  } catch (error) {
    return {
      available: false,
      root: '',
      dirtyFiles: 0,
      unpushedCommits: 0,
      error: error.message,
    };
  }
}

module.exports = { skillsRepoStatus };
