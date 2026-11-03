'use strict';
// How the packages are built and released (docs/DESKTOP.md, .github/workflows/desktop.yml), checked with
// electron-builder's own command-line parsing, since a wrong flag only shows on a user's computer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createRequire } = require('node:module');
const { Arch, Platform } = require('electron-builder');
const { configureBuildCommand, createYargs, normalizeOptions } = require('electron-builder/out/builder.js');
const { computeArchToTargetNamesMap } = require('app-builder-lib/out/targets/targetFactory.js');
// electron-builder reads its YAML with js-yaml; use the same copy.
const yaml = createRequire(require.resolve('app-builder-lib'))('js-yaml');

const desktop = join(__dirname, '..');
const config = yaml.load(readFileSync(join(desktop, 'electron-builder.yml'), 'utf8'));
const workflow = yaml.load(readFileSync(join(desktop, '..', '.github', 'workflows', 'desktop.yml'), 'utf8'));
const scripts = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')).scripts;

/** The architectures and targets an `electron-builder …` command line packages for one platform. */
function packaged(commandLine, platform) {
  const argv = commandLine.trim().split(/\s+/).filter((a) => a !== 'npx' && a !== 'electron-builder');
  const options = normalizeOptions(configureBuildCommand(createYargs()).parse(argv));
  const archs = computeArchToTargetNamesMap(options.targets.get(platform), { platformSpecificBuildOptions: config[platform.buildConfigurationKey] }, platform);
  return Object.fromEntries([...archs].map(([arch, targets]) => [Arch[arch], targets]));
}

/** The command line of the workflow's Package step for one matrix entry. */
function workflowCommand(os) {
  const entry = workflow.jobs.build.strategy.matrix.include.find((e) => e.os.startsWith(os));
  const step = workflow.jobs.build.steps.find((s) => s.name === 'Package');
  return step.run.replace('${{ matrix.target }}', entry.target);
}

test('the macOS dmg is one universal app for Intel and Apple Silicon, whatever Mac builds it', () => {
  // A target named on the command line takes its architecture from the command line (or the Mac that
  // builds it), not from electron-builder.yml: CI's arm64 runner made an Apple-Silicon-only dmg.
  assert.deepEqual(packaged(scripts['dist:mac'], Platform.MAC), { universal: ['dmg'] });
  assert.deepEqual(packaged(workflowCommand('macos'), Platform.MAC), { universal: ['dmg'] });
});

test('the Windows installer is for x64', () => {
  assert.deepEqual(packaged(scripts['dist:win'], Platform.WINDOWS), { x64: ['nsis'] });
  assert.deepEqual(packaged(workflowCommand('windows'), Platform.WINDOWS), { x64: ['nsis'] });
});
