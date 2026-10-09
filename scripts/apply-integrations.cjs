'use strict';
// Applies only the reviewed additions to an existing private source checkout. Never deploys.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const publicRoot = path.resolve(__dirname, '..'), target = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(target,'server/aiconsult/index.js'))) throw Error('Pass the private status-board-source checkout path');
const patches = ['admin-board.patch', 'aiconsult.patch'].map(name => path.join(publicRoot,'integrations',name));
// Both patches must apply before either is written.
execFileSync('git', ['apply', '--ignore-space-change', '--check', ...patches], { cwd: target, stdio: 'inherit' });
for (const name of ['booking-admin.js','booking-admin.css','booking-config.js']) if (fs.existsSync(path.join(target,name))) throw Error('Target already has booking assets; review updates manually: '+name);
execFileSync('git', ['apply', '--ignore-space-change', ...patches], { cwd: target, stdio: 'inherit' });
for (const name of ['booking-admin.js','booking-admin.css','booking-config.js']) fs.copyFileSync(path.join(publicRoot,name), path.join(target,name));
for (const name of ['booking-catalog.js','booking-catalog.test.js','booking-regression.test.js']) fs.copyFileSync(path.join(publicRoot,'integrations/aiconsult',name),path.join(target,'server/aiconsult',name));
console.log('Local integration applied. Inspect git diff and run AI regression tests before deployment.');
