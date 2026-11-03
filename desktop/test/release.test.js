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

test('a tag makes a draft release, published only after both packages are attached', () => {
  // The shell commands of a job, with continued lines joined.
  const runs = (job) => (workflow.jobs[job].steps ?? []).map((s) => (s.run ?? '').replace(/\\\n\s*/g, ' ')).join('\n');
  assert.match(runs('release'), /gh release create [^\n]*--draft/, 'the release starts as a draft');
  // Nothing before the packages are built makes it public.
  for (const job of ['release', 'build']) assert.doesNotMatch(runs(job), /--draft=false/, job);
  const publishers = Object.keys(workflow.jobs).filter((job) => /gh release edit [^\n]*--draft=false/.test(runs(job)));
  assert.equal(publishers.length, 1, 'one job publishes the release');
  const publish = workflow.jobs[publishers[0]];
  assert.deepEqual([publish.needs].flat(), ['build']);
  // Only when every package job succeeded (fail-fast is off, so one platform can fail alone), and only for a tag.
  assert.match(publish.if, /needs\.build\.result == 'success'/);
  assert.match(publish.if, /startsWith\(github\.ref, 'refs\/tags\/desktop-v'\)/);
  // And only with both packages on the release.
  assert.match(runs(publishers[0]), /\.exe\b/);
  assert.match(runs(publishers[0]), /\.dmg\b/);
});

test('a manual run only builds: it never creates, uploads to or publishes a release, even from a tag', () => {
  // "Run workflow" from a desktop-v* tag has that tag as github.ref, so the ref alone does not tell a tag push.
  const tagPush = /github\.event_name == 'push'/;
  const step = (name) => workflow.jobs.build.steps.find((s) => s.name === name);
  assert.match(workflow.jobs.release.if, tagPush, 'release');
  assert.match(step('Take the version from the tag').if, tagPush, 'version from the tag');
  assert.match(step('Attach to the release').if, tagPush, 'attach');
  assert.match(workflow.jobs.publish.if, tagPush, 'publish');
  assert.match(step('List the packages (manual runs)').if, /github\.event_name != 'push'/, 'manual runs list the packages');
  // Manual runs still build (the release job is skipped for them).
  assert.match(workflow.jobs.build.if, /needs\.release\.result == 'skipped'/);
});
