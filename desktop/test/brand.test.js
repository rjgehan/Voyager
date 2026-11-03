'use strict';
// The desktop app is Voyager (ROADMAP item 45, BRAND.md) everywhere Windows and macOS show a name,
// while the identity an update relies on stays NotesApp's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
/** A top-level or indented `key: value` of electron-builder.yml. */
const yaml = (key) => new RegExp(`^\\s*${key}: (.+)$`, 'm').exec(builder)?.[1].trim();

test('product name, installer, shortcut and disk image say Voyager', () => {
  assert.equal(pkg.productName, 'Voyager');
  assert.equal(yaml('productName'), 'Voyager');
  assert.equal(yaml('shortcutName'), 'Voyager');
  assert.match(builder, /^\s*artifactName: Voyager-Setup-\$\{version\}\.\$\{ext\}$/m);
  assert.match(builder, /^\s*artifactName: Voyager-\$\{version\}-mac\.\$\{ext\}$/m);
  assert.equal(yaml('title'), 'Voyager ${version}');
  assert.doesNotMatch(builder.replace(/^\s*#.*$/gm, ''), /NotesApp/);
  assert.match(pkg.description, /^Voyager /);
});

test('the identity an update over NotesApp needs is unchanged', () => {
  // The installer's registry keys and the taskbar's app id come from appId (electron-builder.yml).
  assert.equal(yaml('appId'), 'com.rjgehan.notesapp.desktop');
  assert.match(fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8'), /const APP_ID = 'com\.rjgehan\.notesapp\.desktop';/);
  assert.equal(pkg.name, 'notesapp-desktop');
  // Removing or reinstalling the app keeps its settings and offline data.
  assert.equal(yaml('deleteAppDataOnUninstall'), 'false');
  assert.equal(pkg.version, '1.1.0');
});

test('the icons it names are there, with the small sizes Windows uses', () => {
  assert.equal(yaml('icon'), 'build/icon.ico');
  for (const rel of ['build/icon.ico', 'build/icon.png', 'src/pages/icon.ico', 'src/pages/icon.png', 'src/pages/icon-small.png']) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel);
  }
  const ico = fs.readFileSync(path.join(root, 'build', 'icon.ico'));
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + 16 * i] || 256);
  for (const size of [16, 24, 32, 48, 256]) assert.ok(sizes.includes(size), `icon.ico has ${size} px`);
  const png = fs.readFileSync(path.join(root, 'build', 'icon.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1024, 1024]);
});
