'use strict';

const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { renderReport } = require('./report');

async function build() {
  const json = await readFile(path.join(__dirname, 'report.json'), 'utf8');
  const html = renderReport(JSON.parse(json));
  const output = path.join(__dirname, 'public');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'index.html'), html, 'utf8');
  await writeFile(path.join(output, 'report.json'), json, 'utf8');
  console.log('Static report built in public/');
}

build().catch(error => {
  console.error(`Unable to build report: ${error.message}`);
  process.exitCode = 2;
});
