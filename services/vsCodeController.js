/**
 * A.L.E.C. VS Code / Cursor Controller
 *
 * Opens files, creates projects, runs terminal commands — all from chat.
 * Works with VS Code and Cursor (whichever is installed).
 *
 * Uses:
 *  - VS Code CLI (`code` command) for file/folder opening
 *  - AppleScript to control the GUI (focus window, run commands)
 *  - macOS `open` command as a fallback
 */

const { execFile } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

// ── Detect VS Code / Cursor binary ───────────────────────────────
const VS_CODE_PATHS = [
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
  '/usr/local/bin/code',
  '/opt/homebrew/bin/code',
];
const CURSOR_PATHS = [
  '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
  '/usr/local/bin/cursor',
];

function findEditor() {
  for (const p of [...VS_CODE_PATHS, ...CURSOR_PATHS]) {
    if (fs.existsSync(p)) return { path: p, name: p.includes('cursor') ? 'Cursor' : 'VS Code' };
  }
  return null;
}

function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

function runAS(script) {
  return run('osascript', ['-e', script]);
}

// ── Open a file or folder ─────────────────────────────────────────

/**
 * Open a file in VS Code / Cursor.
 * Falls back to macOS `open -a "Visual Studio Code"` if CLI not found.
 */
async function openFile(filePath, lineNumber = null) {
  const abs = path.resolve(filePath);
  const editor = findEditor();

  if (editor) {
    const args = lineNumber ? [`${abs}:${lineNumber}`] : [abs];
    await run(editor.path, args);
    return { opened: abs, editor: editor.name, lineNumber };
  }

  // Fallback: use open command
  await run('open', ['-a', 'Visual Studio Code', abs]);
  return { opened: abs, editor: 'VS Code (open)', lineNumber };
}

/**
 * Open a folder/project in VS Code.
 */
async function openFolder(folderPath) {
  const abs = path.resolve(folderPath);
  if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });

  const editor = findEditor();
  if (editor) {
    await run(editor.path, [abs]);
    return { opened: abs, editor: editor.name };
  }
  await run('open', ['-a', 'Visual Studio Code', abs]);
  return { opened: abs, editor: 'VS Code' };
}

// ── Create a new file / project ───────────────────────────────────

/**
 * Create a new file with content and open it in VS Code.
 */
async function createAndOpen(filePath, content = '', openInEditor = true) {
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  if (openInEditor) await openFile(abs);
  return { created: abs, size: content.length };
}

/**
 * Create a new Node.js project with package.json + main file.
 */
async function createNodeProject(projectName, targetDir = null, description = '') {
  const dir = path.join(targetDir || path.join(os.homedir(), 'Desktop', 'ALEC-Projects'), projectName);
  fs.mkdirSync(dir, { recursive: true });

  const pkg = {
    name: projectName.toLowerCase().replace(/\s+/g, '-'),
    version: '1.0.0',
    description,
    main: 'index.js',
    scripts: { start: 'node index.js', dev: 'nodemon index.js' },
    dependencies: {},
  };

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  fs.writeFileSync(path.join(dir, 'index.js'), `// ${projectName}\n// Created by A.L.E.C. on ${new Date().toLocaleDateString()}\n\nconsole.log('${projectName} starting...');\n`);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.env\n*.log\n');
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${projectName}\n\n${description}\n\nCreated by A.L.E.C.\n`);

  await openFolder(dir);
  return { created: dir, files: ['package.json', 'index.js', '.gitignore', 'README.md'] };
}

/**
 * Create a Python project.
 */
async function createPythonProject(projectName, targetDir = null, description = '') {
  const dir = path.join(targetDir || path.join(os.homedir(), 'Desktop', 'ALEC-Projects'), projectName);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'main.py'), `# ${projectName}\n# Created by A.L.E.C. on ${new Date().toLocaleDateString()}\n\ndef main():\n    print("${projectName} starting...")\n\nif __name__ == "__main__":\n    main()\n`);
  fs.writeFileSync(path.join(dir, 'requirements.txt'), '# Add dependencies here\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '__pycache__/\n*.pyc\n.env\nvenv/\n');
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${projectName}\n\n${description}\n\nCreated by A.L.E.C.\n`);

  await openFolder(dir);
  return { created: dir, files: ['main.py', 'requirements.txt', '.gitignore', 'README.md'] };
}

// ── Terminal commands (in VS Code's integrated terminal) ──────────

/**
 * Run a terminal command in VS Code's integrated terminal via AppleScript.
 * NOTE: Requires VS Code to already be open.
 */
async function runInTerminal(command, workingDir = null) {
  const safeCmd = command.replace(/"/g, '\\"').replace(/'/g, "\\'").slice(0, 500);
  const cdCmd = workingDir ? `cd "${workingDir}" && ` : '';

  // Try to use VS Code's terminal via AppleScript keystrokes
  const script = `
tell application "Visual Studio Code"
  activate
end tell
delay 0.3
tell application "System Events"
  tell process "Code"
    -- Open new terminal: Ctrl+\`
    keystroke "\`" using control down
    delay 0.5
    keystroke "${cdCmd}${safeCmd}"
    delay 0.1
    key code 36 -- Return
  end tell
end tell`;

  try {
    await runAS(script);
    return { success: true, command, note: 'Command sent to VS Code terminal' };
  } catch (err) {
    // Fallback: run directly in shell and return output
    return new Promise((resolve) => {
      const opts = workingDir ? { cwd: workingDir, timeout: 30000 } : { timeout: 30000 };
      execFile('/bin/zsh', ['-c', command], opts, (err, stdout, stderr) => {
        resolve({
          success: !err,
          output: (stdout || stderr || err?.message || '').slice(0, 2000),
          command,
          note: 'Ran directly (VS Code not available)',
        });
      });
    });
  }
}

// ── Extensions ────────────────────────────────────────────────────

/**
 * Install a VS Code extension.
 */
async function installExtension(extensionId) {
  const editor = findEditor();
  if (!editor) throw new Error('VS Code not found');
  await run(editor.path, ['--install-extension', extensionId]);
  return { installed: extensionId, editor: editor.name };
}

/**
 * List installed extensions.
 */
async function listExtensions() {
  const editor = findEditor();
  if (!editor) return [];
  const raw = await run(editor.path, ['--list-extensions']);
  return raw.split('\n').filter(Boolean);
}

// ── Focus VS Code window ──────────────────────────────────────────
async function focus(appName = 'Code') {
  try {
    await runAS(`tell application "${appName}" to activate`);
    return { focused: appName };
  } catch {
    try {
      await runAS('tell application "Cursor" to activate');
      return { focused: 'Cursor' };
    } catch (e) {
      return { focused: null, error: e.message };
    }
  }
}

// ── Status ────────────────────────────────────────────────────────
function status() {
  const editor = findEditor();
  return {
    available: !!editor,
    editor: editor?.name || null,
    path: editor?.path || null,
  };
}

module.exports = {
  openFile, openFolder, createAndOpen,
  createNodeProject, createPythonProject,
  runInTerminal, installExtension, listExtensions,
  focus, status, findEditor,
};
