'use strict';

const fs = require('fs');
const path = require('path');

const PLAN_BRAND = Symbol('trusted-executable-location-plan');
const LOCATION_LIMIT = 2;
const ROOT_IDS = Object.freeze({
  packaged: 'PACKAGED_PROCESS_RESOURCES_FFMPEG',
  development: 'DEVELOPMENT_REPOSITORY_RESOURCES_FFMPEG'
});
const REASON_IDS = Object.freeze({
  ready: 'TRUSTED_RUNTIME_READY',
  ffmpegMissing: 'TRUSTED_FFMPEG_MISSING',
  ffprobeMissing: 'TRUSTED_FFPROBE_MISSING',
  bothMissing: 'TRUSTED_FFMPEG_AND_FFPROBE_MISSING'
});
const EXECUTABLE_NAMES = Object.freeze({
  win32: Object.freeze({ ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe' }),
  other: Object.freeze({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' })
});

function runtimeMode(app) {
  if (!app || typeof app !== 'object' || typeof app.isPackaged !== 'boolean') {
    throw new TypeError('The trusted runtime resolver requires an Electron app with isPackaged.');
  }
  return app.isPackaged ? 'packaged' : 'development';
}

function executableNames() {
  return process.platform === 'win32' ? EXECUTABLE_NAMES.win32 : EXECUTABLE_NAMES.other;
}

function developmentRoot() {
  // src/runtime -> src -> repository root. This is the only development root.
  return path.resolve(__dirname, '..', '..', 'resources', 'ffmpeg');
}

function packagedRoot() {
  const resourcesPath = process.resourcesPath;
  if (typeof resourcesPath !== 'string' || !path.isAbsolute(resourcesPath)) {
    const error = new Error('The packaged resources path is unavailable.');
    error.code = 'TRUSTED_PACKAGED_RESOURCES_UNAVAILABLE';
    throw error;
  }
  return path.join(resourcesPath, 'ffmpeg');
}

/**
 * Resolve the two fixed trusted locations. This module is intentionally internal:
 * it accepts only app.isPackaged and never accepts a caller-selected executable or
 * searches PATH. The returned absolute paths are for main-process use only.
 */
function enumerateTrustedExecutableLocations(app) {
  const mode = runtimeMode(app);
  const names = executableNames();
  const root = mode === 'packaged' ? packagedRoot() : developmentRoot();
  const locations = Object.freeze([
    Object.freeze({ id: 'ffmpeg', fileName: names.ffmpeg, path: path.join(root, names.ffmpeg) }),
    Object.freeze({ id: 'ffprobe', fileName: names.ffprobe, path: path.join(root, names.ffprobe) })
  ]);
  if (locations.length !== LOCATION_LIMIT) {
    throw new Error('The trusted runtime location enumeration is unexpectedly unbounded.');
  }
  return Object.freeze({
    [PLAN_BRAND]: true,
    mode,
    rootId: ROOT_IDS[mode],
    root,
    locations,
    ffmpeg: locations[0].path,
    ffprobe: locations[1].path
  });
}

function assertPlan(plan) {
  if (!plan || plan[PLAN_BRAND] !== true || !Array.isArray(plan.locations) || plan.locations.length !== LOCATION_LIMIT) {
    throw new TypeError('The trusted runtime status requires a resolver-owned location plan.');
  }
  const names = executableNames();
  const expected = [
    { id: 'ffmpeg', fileName: names.ffmpeg, path: path.join(plan.root, names.ffmpeg) },
    { id: 'ffprobe', fileName: names.ffprobe, path: path.join(plan.root, names.ffprobe) }
  ];
  for (let index = 0; index < expected.length; index += 1) {
    const actual = plan.locations[index];
    if (!actual || actual.id !== expected[index].id || actual.fileName !== expected[index].fileName || actual.path !== expected[index].path) {
      throw new TypeError('The trusted runtime location plan was altered.');
    }
  }
}

function isRegularFile(filePath) {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

/**
 * Return bounded, renderer-safe metadata. It names the fixed search entries but
 * deliberately omits absolute paths and all filesystem error text.
 */
function inspectTrustedExecutableLocations(plan) {
  assertPlan(plan);
  const ffmpeg = isRegularFile(plan.ffmpeg);
  const ffprobe = isRegularFile(plan.ffprobe);
  const ready = ffmpeg && ffprobe;
  const reasonId = ready
    ? REASON_IDS.ready
    : !ffmpeg && !ffprobe
      ? REASON_IDS.bothMissing
      : !ffmpeg
        ? REASON_IDS.ffmpegMissing
        : REASON_IDS.ffprobeMissing;
  return Object.freeze({
    mode: plan.mode,
    rootId: plan.rootId,
    status: ready ? 'ready' : 'unavailable',
    reasonId,
    ready,
    locationsChecked: LOCATION_LIMIT,
    ffmpeg: Object.freeze({ fileName: plan.locations[0].fileName, regularFile: ffmpeg }),
    ffprobe: Object.freeze({ fileName: plan.locations[1].fileName, regularFile: ffprobe })
  });
}

function trustedExecutableStatus(app) {
  return inspectTrustedExecutableLocations(enumerateTrustedExecutableLocations(app));
}

module.exports = {
  enumerateTrustedExecutableLocations,
  inspectTrustedExecutableLocations,
  trustedExecutableStatus,
  REASON_IDS
};
