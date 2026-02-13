#!/usr/bin/env node
/**
 * Postinstall patch: configure chrono-node in @basementuniverse/kanbn to use
 * littleEndian=true (DD/MM/YYYY) instead of the default US MM/DD/YYYY.
 *
 * Without this, dates like "10/02/2026" (10th Feb) are parsed as Oct 2.
 */
const fs = require('fs');
const path = require('path');

const KANBN_SRC = path.join(
  __dirname, '..', 'node_modules', '@basementuniverse', 'kanbn', 'src'
);

const OLD_IMPORT = "const chrono = require('chrono-node');";
const NEW_IMPORT = [
  "const chronoNode = require('chrono-node');",
  "const chrono = new chronoNode.Chrono(chronoNode.en.createConfiguration(false, true));"
].join('\n');

const FILES = [
  'parse-task.js',
  'controller/status.js',
  'controller/find.js',
  'controller/burndown.js',
  'controller/edit.js',
  'controller/add.js',
];

let patched = 0;
for (const rel of FILES) {
  const filepath = path.join(KANBN_SRC, rel);
  if (!fs.existsSync(filepath)) continue;
  let content = fs.readFileSync(filepath, 'utf8');
  if (content.includes(OLD_IMPORT)) {
    content = content.replace(OLD_IMPORT, NEW_IMPORT);
    fs.writeFileSync(filepath, content, 'utf8');
    patched++;
  }
}

console.log(`[patch-kanbn-chrono] Patched ${patched}/${FILES.length} files for DD/MM/YYYY date parsing.`);
