#!/usr/bin/env node
const { spawn } = require('child_process');

const args = process.argv.slice(2);

if (args[0] === 'worker') {
  const child = spawn('npx', ['wrangler', 'dev', '--local'], { stdio: 'inherit' });
  child.on('exit', code => process.exit(code));
} else {
  console.log('Usage: grant-manager worker');
}
