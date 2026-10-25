// Launches Electron with a clean environment. Some hosts (e.g. VS Code extension
// terminals) set ELECTRON_RUN_AS_NODE, which would make Electron behave like plain Node.
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env, cwd: require('path').join(__dirname, '..') });
child.on('exit', (code) => process.exit(code ?? 0));
