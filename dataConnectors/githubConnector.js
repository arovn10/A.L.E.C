// dataConnectors/githubConnector.js
'use strict';

const { Octokit } = require('@octokit/rest');

const OWNER = 'Stoa-Group';
const REPO  = 'stoagroupDB';

let _octokit = null;
function getOctokit() {
  if (!_octokit) {
    if (!process.env.GITHUB_TOKEN) throw new Error('[githubConnector] GITHUB_TOKEN not set');
    _octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }
  return _octokit;
}

/**
 * GitHub connector — reads files from Stoa-Group/stoagroupDB.
 * Never commits or pushes. Hard Rule H1.
 *
 * params:
 *   { action: 'listFiles', path?: string }
 *   { action: 'getFile',   path: string }
 *   { action: 'getCommits', since?: string }
 */
const githubConnector = {
  name: 'github',
  tags: ['stoa', 'stoagroupDB', 'schema', 'migrations', 'docs'],
  schema: {
    description: 'GitHub stoagroupDB — schemas, migrations, data exports.',
    params: { action: 'listFiles|getFile|getCommits', path: 'file path in repo', since: 'ISO8601 date' },
  },
  async fetch({ action, path: filePath = '', since } = {}) {
    const octokit = getOctokit();

    if (action === 'listFiles') {
      const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: filePath });
      const items = Array.isArray(data) ? data : [data];
      return { files: items.map(f => ({ name: f.name, path: f.path, type: f.type, sha: f.sha })) };
    }

    if (action === 'getFile') {
      const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: filePath });
      if (data.type !== 'file') throw new Error(`${filePath} is not a file`);
      return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
    }

    if (action === 'getCommits') {
      const params = { owner: OWNER, repo: REPO, per_page: 50 };
      if (since) params.since = since;
      const { data } = await octokit.repos.listCommits(params);
      return { commits: data.map(c => ({ sha: c.sha, message: c.commit.message, date: c.commit.author.date })) };
    }

    throw new Error(`[githubConnector] Unknown action: ${action}`);
  },
};

module.exports = githubConnector;
