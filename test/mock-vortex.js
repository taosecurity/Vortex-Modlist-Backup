// Mock-Vortex test for 0.6.0 automatic export + Apply Recommended Load Order.
// Run after building: node test\mock-vortex.js   (loads dist\index.js; writes only to a new folder in %TEMP%)
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mlb-test-"));
const exportDir = path.join(tmp, "Exports");
const recDir = path.join(tmp, "loadorder");
const staging = path.join(tmp, "staging");
const userData = path.join(tmp, "Vortex");
const local = path.join(tmp, "Local");
[exportDir, recDir, path.join(recDir, "Default"), userData, path.join(local, "Starfield"),
  path.join(staging, "modA"), path.join(staging, "modB")].forEach((d) => fs.mkdirSync(d, { recursive: true }));
fs.writeFileSync(path.join(staging, "modA", "A.esm"), "");
fs.writeFileSync(path.join(staging, "modB", "B.esm"), "");
process.env.LOCALAPPDATA = local;
const pluginsTxt = path.join(local, "Starfield", "Plugins.txt");
fs.writeFileSync(pluginsTxt, "# test\r\n*A.esm\r\n*B.esm\r\n*C.esm\r\n");

// ---------- mock Vortex ----------
const logs = [];
const notes = [];
const dialogs = [];
let answers = [];
const timers = [];
const lo = (ids) => ids.map((id) => ({ id: id.toLowerCase(), name: id, enabled: true, ...(id === "Starfield.esm" ? { locked: true } : {}) }));
let state = {
  settings: {
    profiles: { activeProfileId: "p1", lastActiveProfile: {} },
    automation: { install: false },
    starfield: { loadOrderManagementType: { p1: "dnd" } },
  },
  persistent: {
    profiles: { p1: { id: "p1", gameId: "starfield", name: "Default", lastActivated: 1,
      modState: { modA: { enabled: true }, modB: { enabled: true }, modC: { enabled: false } } } },
    mods: { starfield: {
      modA: { id: "modA", installationPath: "modA", attributes: { modId: 1, fileId: 2, source: "nexus", downloadGame: "starfield", modName: "A", version: "1.0" } },
      modB: { id: "modB", installationPath: "modB", attributes: { name: "B (from file)" } },
      modC: { id: "modC", installationPath: "modC", attributes: { modId: 3, fileId: 4, source: "nexus", downloadGame: "starfield", modName: "C" } },
    } },
    downloads: { files: {} },
    loadOrder: { p1: lo(["Starfield.esm", "A.esm", "B.esm", "C.esm"]) },
    nexus: { userInfo: {} },
  },
  loadOrder: {},
  session: { plugins: { pluginList: {} } },
};
const listeners = { async: {}, state: [] };
const setLoadOrder = (profileId, order) => {
  state = { ...state, persistent: { ...state.persistent, loadOrder: { ...state.persistent.loadOrder, [profileId]: order } } };
  listeners.state.filter((l) => l.path.join(".") === "persistent.loadOrder").forEach((l) => l.cb());
};
const vortexApi = {
  actions: {
    setFBLoadOrder: (profileId, loadOrder) => ({ type: "SET_FB_LOAD_ORDER", payload: { profileId, loadOrder } }),
    setModEnabled: () => ({ type: "noop" }),
  },
  selectors: { installPathForGame: () => staging, activeProfile: (s) => s.persistent.profiles.p1 },
  log: (level, msg) => logs.push(`${level}: ${msg}`),
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === "vortex-api" ? vortexApi : origLoad.call(this, request, ...rest);
};
global.setTimeout = (fn) => { timers.push(fn); return timers.length; };
global.clearTimeout = () => { timers.length = 0; };
const flush = () => { const fns = timers.splice(0); fns.forEach((fn) => fn()); };

const actionsByTitle = {};
const onceCbs = [];
const api = {
  store: {
    getState: () => state,
    dispatch: (action) => { if (action.type === "SET_FB_LOAD_ORDER") setLoadOrder(action.payload.profileId, action.payload.loadOrder); },
  },
  getState: () => state,
  getPath: (name) => { if (name !== "userData") throw new Error("bad path"); return userData; },
  onAsync: (name, fn) => { listeners.async[name] = fn; },
  onStateChange: (p, cb) => listeners.state.push({ path: p, cb }),
  showDialog: (type, title, content, buttons) => {
    dialogs.push({ type, title, content, buttons: buttons.map((b) => b.label) });
    const a = answers.shift();
    return Promise.resolve(a ? (typeof a === "function" ? a(content) : a) : { action: buttons[0].label, input: {} });
  },
  sendNotification: (n) => notes.push(`${n.type}: ${n.title}: ${n.message}`),
  showErrorNotification: (t, m) => notes.push(`error: ${t}: ${m}`),
  events: { emit: () => undefined, on: () => undefined },
  ext: { addSourceToModlistBackup: () => undefined },
  selectFile: () => Promise.resolve(undefined),
};
const context = {
  api,
  once: (cb) => onceCbs.push(cb),
  registerAPI: () => undefined,
  registerAction: (group, pos, icon, opts, title, fn) => { actionsByTitle[`${group}|${title}`] = { icon, fn }; },
};

// ---------- run ----------
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) failed++; };
const files = () => fs.readdirSync(exportDir).filter((f) => f.startsWith("vortex-")).sort();
const sleep = (ms) => new Promise((r) => require("timers").setTimeout(r, ms));
const act = (title, group = "mod-icons") => actionsByTitle[`${group}|${title}`].fn();

(async () => {
  require(path.join(__dirname, "..", "dist", "index.js")).default(context);
  onceCbs.forEach((cb) => cb());
  check(["Automatic Export Settings", "Export for Load Order Check Now", "Apply Recommended Load Order"]
    .every((t) => actionsByTitle[`mod-icons|${t}`]) && actionsByTitle["fb-load-order-icons|Apply Recommended Load Order"],
    "toolbar actions registered");

  // 1. Off by default: a deploy exports nothing
  await listeners.async["did-deploy"]("p1");
  flush();
  check(files().length === 0, "automatic export is off until settings are saved");

  // 2. Settings dialog
  answers.push({ action: "Save", input: { enabled: true, folder: exportDir, recommendedFolder: `"${recDir}"` } });
  act("Automatic Export Settings");
  await sleep(20);
  const saved = JSON.parse(fs.readFileSync(path.join(userData, "modlist-backup-auto-export.json"), "utf8"));
  check(saved.enabled === true && saved.folder === exportDir && saved.recommendedFolder === recDir, "settings saved (quotes stripped)");
  flush(); // settings save schedules one export
  let f = files();
  const stamp1 = (f[0] || "").match(/(\d{8}-\d{6})/)?.[1];
  check(f.length === 3 && f.every((n) => n.includes(stamp1)), `three files with one stamp: ${f.join(", ")}`);
  check(f.includes(`vortex-starfield-Default-plugins-${stamp1}.txt`), "plugins copy named vortex-starfield-<profile>-plugins-<stamp>.txt");
  check(fs.readFileSync(path.join(exportDir, `vortex-starfield-Default-plugins-${stamp1}.txt`), "utf8") === fs.readFileSync(pluginsTxt, "utf8"), "plugins copy is byte-identical");
  const mods = JSON.parse(fs.readFileSync(path.join(exportDir, `vortex-starfield-Default-modlist-backup-${stamp1}.json`), "utf8"));
  check(mods.length === 2 && mods.map((m) => m.vortexId).join() === "modA,modB" && mods[1].source === "local" && mods[0].plugins[0] === "A.esm", "modlist = enabled mods incl. local, with plugins");
  const lo1 = JSON.parse(fs.readFileSync(path.join(exportDir, `vortex-starfield-Default-loadorder-backup-${stamp1}.json`), "utf8"));
  check(JSON.stringify(lo1) === JSON.stringify(state.persistent.loadOrder.p1), "load order file = Load Order page list");

  // 3. No change: nothing new
  await listeners.async["did-deploy"]("p1");
  flush();
  check(files().length === 3, "no new files when nothing changed");

  // 4. A manual export with no change says so
  act("Export for Load Order Check Now");
  check(notes[notes.length - 1].startsWith("info: Nothing new to export"), "manual export with no change: 'Nothing new to export'");

  // 5. Change (like a LOOT sort): new set, old set moved to old\
  await sleep(1100);
  setLoadOrder("p1", lo(["Starfield.esm", "B.esm", "A.esm", "C.esm"]));
  flush();
  f = files();
  const stamp2 = (f[0] || "").match(/(\d{8}-\d{6})/)?.[1];
  check(f.length === 3 && stamp2 > stamp1, `load order change exports a new set (${stamp2})`);
  check(fs.readdirSync(path.join(exportDir, "old")).length === 3, "older set moved to old\\");

  // 6. Apply: recommended file for the newest export, A back above B
  const recFile = path.join(recDir, "Default", `vortex-starfield-Default-loadorder-recommended-${stamp2}.json`);
  fs.writeFileSync(recFile, JSON.stringify(lo(["Starfield.esm", "A.esm", "B.esm", "C.esm"]), null, 2));
  fs.writeFileSync(path.join(recDir, "Default", "status.json"), JSON.stringify({ stamp: stamp2, summary: "0 problem(s); my order differs: 1 plugin(s) move." }));
  answers.push((content) => ({ action: "Apply", input: {} }));
  await act("Apply Recommended Load Order");
  let d = dialogs[dialogs.length - 1];
  check(d.title === "Apply Recommended Load Order" && d.buttons.join() === "Cancel,Apply", "apply dialog asks first");
  check(/1 plugin\(s\) move/.test(d.content.text) && /Check result: 0 problem/.test(d.content.message), `dialog shows moves + check result: ${JSON.stringify(d.content.message)}`);
  check(state.persistent.loadOrder.p1.map((e) => e.name).join() === "Starfield.esm,A.esm,B.esm,C.esm", "new order applied to the Load Order page");
  check(notes[notes.length - 1].startsWith("success: Recommended load order applied"), "success notification");
  check(timers.length === 1, "apply schedules a new export");
  await sleep(1100);
  flush();
  check(files().length === 3 && !files()[0].includes(stamp2), "re-export after apply");

  // 7. Already matches
  fs.renameSync(recFile, recFile.replace(stamp2, "29991231-235959"));
  const n = dialogs.length;
  await act("Apply Recommended Load Order");
  check(dialogs.length === n && notes[notes.length - 1].startsWith("success: Load order already matches"), "same order: nothing to apply, no dialog");
  fs.unlinkSync(recFile.replace(stamp2, "29991231-235959"));

  // 8. Stale (older stamp than the newest export): "Apply anyway"; cancel
  fs.writeFileSync(recFile, JSON.stringify(lo(["Starfield.esm", "C.esm", "A.esm", "B.esm"]), null, 2));
  await act("Apply Recommended Load Order");
  d = dialogs[dialogs.length - 1];
  check(d.buttons.join() === "Cancel,Apply anyway" && /newer export/.test(d.content.message), "older recommendation: asks 'Apply anyway'");
  check(state.persistent.loadOrder.p1.map((e) => e.name).join() === "Starfield.esm,A.esm,B.esm,C.esm", "cancel leaves the order alone");

  // 9. Different plugins: refuse
  fs.writeFileSync(recFile, JSON.stringify(lo(["Starfield.esm", "A.esm", "B.esm", "D.esm"]), null, 2));
  await act("Apply Recommended Load Order");
  d = dialogs[dialogs.length - 1];
  check(d.title === "Recommended load order is out of date" && /C\.esm/.test(d.content.message) && /D\.esm/.test(d.content.message), "plugin set differs: refused, names both sides");

  // 10. Classic method: refuse
  state.settings.starfield.loadOrderManagementType.p1 = "gamebryo";
  await act("Apply Recommended Load Order", "fb-load-order-icons");
  check(notes[notes.length - 1].startsWith("error: Only the Load Order page can be set"), "Classic method: refused");

  console.log(`\n${failed === 0 ? "ALL PASSED" : failed + " FAILED"}  (temp folder ${tmp})`);
  console.log("log lines:\n  " + logs.join("\n  "));
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
