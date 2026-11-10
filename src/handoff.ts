// Automatic export and "Apply Recommended Load Order" (0.6.0).
//
// Automatic export: after each deploy or load order change (debounced), write the active profile's modlist backup,
// its load order backup and a copy of the game's plugins.txt to a folder the user picks, all three with the same
// timestamp, so another tool (or person) can check the load order without anyone exporting by hand:
//    vortex-<game>-<profile>-modlist-backup-<timestamp>.json
//    vortex-<game>-<profile>-loadorder[-classic]-backup-<timestamp>.json
//    vortex-<game>-<profile>-plugins-<timestamp>.txt
// Nothing is written when all three would be the same as the newest set already in the folder. Older sets for the
// same profile are moved (never deleted) to an "old" folder inside it.
//
// Apply: read the newest vortex-<game>-<profile>-loadorder-recommended-<timestamp>.json from
// <recommended folder>\<profile>\ (the Load Order page's own Export format, reordered), show what moves, and on
// confirmation set it as the profile's load order, like the Load Order page's Import button. It refuses when the
// installed plugins no longer match the file, and asks first when the file was made for an older export.
//
// Settings live in a small JSON file in Vortex's own folder (%APPDATA%\Vortex), and are off until the user saves them.

import { IState } from "vortex-api/lib/types/IState";
import { IExtensionContext } from "vortex-api/lib/types/IExtensionContext";
import { actions, log } from "vortex-api";
import getSafe from "./getSafe";

const path = require("path");
const fs = require("fs");

export interface HandoffHelpers {
  // The active profile's modlist backup and load order backup, as the toolbar's profile backup would write them
  profileModlist: (state: IState) => { text: string; gameId: string; profile: any };
  profileLoadOrder: (
    state: IState,
  ) => { text: string; entries: any[]; source: "classic" | "dnd" } | undefined;
  fileNamePart: (name: string) => string;
  fileNameTimestamp: () => string;
  loadOrderFileName: (backupPath: string, source: "classic" | "dnd") => string;
}

interface Settings {
  enabled: boolean;
  folder: string;
  recommendedFolder: string;
}

const DEBOUNCE_MS = 10000;
// After a profile switch Vortex updates its load order state at once but rewrites plugins.txt a little later, so an
// export can catch the previous profile's plugins.txt. An automatic export waits (retrying) until plugins.txt matches
// the profile, for up to RETRY_MS * MAX_TRIES, then exports anyway with a warning (0.6.1).
const RETRY_MS = 5000;
const MAX_TRIES = 12;
const PREFIX = "[MLB]";

// Does plugins.txt list exactly the profile's enabled plugins? The game's own plugins (locked entries) are left out of
// plugins.txt by Vortex, so they don't count. Names are compared without regard to case.
export const pluginsMatch = (
  entries: any[] | undefined,
  pluginsText: string | undefined,
): { ok: boolean; onlyInFile: string[]; onlyInProfile: string[] } => {
  if (!Array.isArray(entries) || pluginsText === undefined) return { ok: true, onlyInFile: [], onlyInProfile: [] };
  const profile = new Set(
    entries
      .filter((entry) => entry?.enabled === true && entry?.locked !== true)
      .map((entry) => String(entry?.name ?? entry?.id ?? "").toLowerCase()),
  );
  const file = new Set(
    pluginsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("*"))
      .map((line) => line.slice(1).trim().toLowerCase()),
  );
  const onlyInFile = [...file].filter((name) => !profile.has(name));
  const onlyInProfile = [...profile].filter((name) => !file.has(name));
  return { ok: onlyInFile.length === 0 && onlyInProfile.length === 0, onlyInFile, onlyInProfile };
};

const mismatchText = (check: { onlyInFile: string[]; onlyInProfile: string[] }) =>
  `plugins.txt doesn't match this profile (${check.onlyInFile.length} enabled there but not in the profile, ` +
  `${check.onlyInProfile.length} enabled in the profile but not there); deploy in Vortex to refresh it`;

// Where each supported game keeps plugins.txt, under %LOCALAPPDATA%
const PLUGINS_TXT_DIR: Record<string, string> = {
  starfield: "Starfield",
  skyrimse: "Skyrim Special Edition",
  fallout4: "Fallout4",
};

const pluginsTxtPath = (gameId: string): string | undefined => {
  const dir = PLUGINS_TXT_DIR[gameId];
  const local = process.env.LOCALAPPDATA;
  return dir !== undefined && local ? path.join(local, dir, "Plugins.txt") : undefined;
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Files of one profile's automatic export sets: { stamp: { modlist, loadorder, plugins } }
const exportSets = (
  folder: string,
  gamePart: string,
  profilePart: string,
): Record<string, Record<string, string>> => {
  const pattern = new RegExp(
    `^vortex-${escapeRegExp(gamePart)}-${escapeRegExp(profilePart)}-` +
      `(modlist|loadorder|plugins)(?:-classic)?(?:-backup)?-(\\d{8}-\\d{6})\\.(json|txt)$`,
    "i",
  );
  const sets: Record<string, Record<string, string>> = {};
  let names: string[] = [];
  try {
    names = fs.readdirSync(folder);
  } catch (error) {
    return sets;
  }
  names.forEach((name) => {
    const match = pattern.exec(name);
    if (match === null) return;
    const kind = match[1].toLowerCase();
    (sets[match[2]] = sets[match[2]] || {})[kind] = path.join(folder, name);
  });
  return sets;
};

const readText = (filePath: string): string | undefined => {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return undefined;
  }
};

// Write to a temporary file first and rename it, so a reader never sees a half written file
const writeFileSafe = (filePath: string, data: string) => {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, data);
  fs.renameSync(tempPath, filePath);
};

// The longest common subsequence of two lists of ids; the entries outside it are the ones that moved
const unmoved = (before: string[], after: string[]): Set<string> => {
  const n = before.length;
  const m = after.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
  const keep = new Set<string>();
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (before[i] === after[j]) {
      keep.add(before[i]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return keep;
};

const entryId = (entry: any): string => String(entry?.id ?? entry?.name ?? "").toLowerCase();

export const registerHandoff = (context: IExtensionContext, helpers: HandoffHelpers) => {
  const { api } = context;

  const settingsPath = (): string => {
    let base: string;
    try {
      base = api.getPath("userData");
    } catch (error) {
      base = undefined;
    }
    return path.join(base || path.join(process.env.APPDATA || ".", "Vortex"), "modlist-backup-auto-export.json");
  };

  const readSettings = (): Settings => {
    const defaults: Settings = { enabled: false, folder: "", recommendedFolder: "" };
    try {
      return { ...defaults, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) };
    } catch (error) {
      return defaults;
    }
  };

  // ---------- automatic export ----------
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const exportNow = (reason: string, manual: boolean, attempt = 0) => {
    const settings = readSettings();
    if (!manual && !settings.enabled) return;
    if (!settings.folder || !fs.existsSync(settings.folder)) {
      if (manual)
        api.showErrorNotification(
          "No export folder",
          "Pick an existing export folder in Automatic Export Settings first",
          { allowReport: false },
        );
      else log("warn", `${PREFIX} automatic export skipped: export folder "${settings.folder}" not found`);
      return;
    }

    const state: IState = api.store.getState();
    let modlist;
    try {
      modlist = helpers.profileModlist(state);
    } catch (error) {
      log("warn", `${PREFIX} automatic export skipped: ${error}`);
      return;
    }
    if (modlist.gameId === undefined || modlist.profile === undefined) return;

    const loadOrder = helpers.profileLoadOrder(state);
    const txtPath = pluginsTxtPath(modlist.gameId);
    const pluginsText = txtPath !== undefined ? readText(txtPath) : undefined;

    // Wait for plugins.txt to belong to this profile (automatic exports only; a manual export goes ahead with a warning)
    const check = pluginsMatch(loadOrder?.entries, pluginsText);
    if (!check.ok && !manual && attempt < MAX_TRIES) {
      log("debug", `${PREFIX} ${reason}: ${mismatchText(check)}; trying again in ${RETRY_MS / 1000} s (${attempt + 1}/${MAX_TRIES})`);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        try {
          exportNow("waiting for plugins.txt", false, attempt + 1);
        } catch (error) {
          log("error", `${PREFIX} automatic export failed: ${error}`);
        }
      }, RETRY_MS);
      return;
    }
    if (!check.ok) log("warn", `${PREFIX} ${reason}: exporting anyway: ${mismatchText(check)}`);

    const gamePart = helpers.fileNamePart(modlist.gameId);
    const profilePart = helpers.fileNamePart(modlist.profile.name ?? modlist.profile.id);

    // Skip when nothing changed since the newest set in the folder
    const sets = exportSets(settings.folder, gamePart, profilePart);
    const newest = Object.keys(sets).sort().pop();
    if (newest !== undefined) {
      const files = sets[newest];
      const same =
        readText(files.modlist) === modlist.text &&
        readText(files.loadorder) === loadOrder?.text &&
        readText(files.plugins) === pluginsText;
      if (same) {
        log("debug", `${PREFIX} ${reason}: no change since ${newest}, nothing exported`);
        if (manual)
          api.sendNotification({
            type: "info",
            title: "Nothing new to export",
            message: `The newest export (${newest}) already matches this profile`,
            displayMS: 5000,
          });
        return;
      }
    }

    const stamp = helpers.fileNameTimestamp();
    const modlistPath = path.join(
      settings.folder,
      `vortex-${gamePart}-${profilePart}-modlist-backup-${stamp}.json`,
    );
    const written: string[] = [];
    try {
      writeFileSafe(modlistPath, modlist.text);
      written.push(modlistPath);
      if (loadOrder !== undefined) {
        const loadOrderPath = helpers.loadOrderFileName(modlistPath, loadOrder.source);
        writeFileSafe(loadOrderPath, loadOrder.text);
        written.push(loadOrderPath);
      }
      if (pluginsText !== undefined) {
        const pluginsPath = path.join(
          settings.folder,
          `vortex-${gamePart}-${profilePart}-plugins-${stamp}.txt`,
        );
        writeFileSafe(pluginsPath, pluginsText);
        written.push(pluginsPath);
      }
    } catch (error) {
      api.showErrorNotification("Automatic export failed", `${error}`, { allowReport: false });
      return;
    }

    // Move the profile's older sets out of the way, so the folder's newest set is the only one at the top
    const oldDir = path.join(settings.folder, "old");
    Object.keys(sets).forEach((oldStamp) => {
      Object.values(sets[oldStamp]).forEach((file) => {
        try {
          fs.mkdirSync(oldDir, { recursive: true });
          fs.renameSync(file, path.join(oldDir, path.basename(file)));
        } catch (error) {
          log("warn", `${PREFIX} couldn't move ${file} to ${oldDir}: ${error}`);
        }
      });
    });

    const missing = [
      loadOrder === undefined ? "load order (this profile has none)" : undefined,
      pluginsText === undefined ? `plugins.txt (${txtPath ?? "not known for this game"})` : undefined,
    ].filter((part) => part !== undefined);
    const warn = missing.length > 0 || !check.ok;
    log("info", `${PREFIX} ${reason}: exported ${written.map((file) => path.basename(file)).join(", ")}`);
    api.sendNotification({
      type: warn ? "warning" : "success",
      title: "Exported for a load order check",
      message:
        `${written.length} files (${stamp}) in ${settings.folder}` +
        (missing.length > 0 ? `. Missing: ${missing.join(", ")}` : "") +
        (!check.ok ? `. Warning: ${mismatchText(check)}` : ""),
      displayMS: warn ? undefined : 5000,
    });
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleExport = (reason: string) => {
    if (!readSettings().enabled) return;
    if (timer !== undefined) clearTimeout(timer);
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer); // a new trigger starts the wait for plugins.txt over
      retryTimer = undefined;
    }
    timer = setTimeout(() => {
      timer = undefined;
      try {
        exportNow(reason, false);
      } catch (error) {
        log("error", `${PREFIX} automatic export failed: ${error}`);
      }
    }, DEBOUNCE_MS);
  };

  // ---------- settings ----------
  const editSettings = () => {
    const settings = readSettings();
    api
      .showDialog(
        "question",
        "Automatic Export Settings",
        {
          text:
            "After each deploy or load order change, export this profile's modlist, load order and plugins.txt " +
            "to the export folder (all three with the same timestamp). Apply Recommended Load Order reads " +
            "<recommended folder>\\<profile>\\vortex-<game>-<profile>-loadorder-recommended-<timestamp>.json.",
          checkboxes: [
            {
              id: "enabled",
              text: "Export automatically after each deploy or load order change",
              value: settings.enabled,
            },
          ],
          input: [
            { id: "folder", label: "Export folder", value: settings.folder, placeholder: "D:\\Exports" },
            {
              id: "recommendedFolder",
              label: "Recommended load order folder",
              value: settings.recommendedFolder,
              placeholder: "D:\\Recommendations",
            },
          ],
        } as any,
        [{ label: "Cancel" }, { label: "Save" }],
      )
      .then((result) => {
        if (result?.action !== "Save") return;
        const input = result.input || {};
        const next: Settings = {
          enabled: input.enabled === true,
          folder: String(input.folder ?? "").trim().replace(/^"|"$/g, ""),
          recommendedFolder: String(input.recommendedFolder ?? "").trim().replace(/^"|"$/g, ""),
        };
        const bad = [next.folder, next.recommendedFolder].filter(
          (folder) => folder !== "" && !fs.existsSync(folder),
        );
        if (next.enabled && next.folder === "") bad.push("(no export folder)");
        if (bad.length > 0) {
          api.showErrorNotification(
            "Settings not saved",
            `These folders don't exist: ${bad.join(", ")}`,
            { allowReport: false },
          );
          return;
        }
        fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
        log("info", `${PREFIX} settings saved: ${JSON.stringify(next)}`);
        api.sendNotification({
          type: "success",
          title: "Automatic export settings saved",
          message: next.enabled ? `Exporting to ${next.folder} after each change` : "Automatic export is off",
          displayMS: 5000,
        });
        if (next.enabled) scheduleExport("settings saved");
      });
  };

  // ---------- apply recommended load order ----------
  const applyRecommended = async () => {
    const settings = readSettings();
    const state: IState = api.store.getState();
    let modlist;
    try {
      modlist = helpers.profileModlist(state);
    } catch (error) {
      modlist = undefined;
    }
    if (modlist?.profile === undefined) {
      api.showErrorNotification("No game is being managed", "Select a game first", { allowReport: false });
      return;
    }
    const profile = modlist.profile;
    const current = helpers.profileLoadOrder(state);
    if (current === undefined || current.source !== "dnd") {
      api.showErrorNotification(
        "Only the Load Order page can be set",
        "This profile uses the Plugins page (Rules-based / Classic). Switch the load order method to the default " +
          "(Load Order page), or change the order by hand",
        { allowReport: false },
      );
      return;
    }
    if (!settings.recommendedFolder) {
      api.showErrorNotification(
        "No recommended load order folder",
        "Set it in Automatic Export Settings first",
        { allowReport: false },
      );
      return;
    }

    const gamePart = helpers.fileNamePart(modlist.gameId);
    const profilePart = helpers.fileNamePart(profile.name ?? profile.id);
    const dir = path.join(settings.recommendedFolder, profilePart);
    const pattern = new RegExp(
      `^vortex-${escapeRegExp(gamePart)}-${escapeRegExp(profilePart)}-loadorder-recommended-(\\d{8}-\\d{6})\\.json$`,
      "i",
    );
    let candidates: string[] = [];
    try {
      candidates = fs.readdirSync(dir).filter((name: string) => pattern.test(name)).sort();
    } catch (error) {
      candidates = [];
    }
    const fileName = candidates.pop();
    if (fileName === undefined) {
      api.showErrorNotification(
        "No recommended load order",
        `No vortex-${gamePart}-${profilePart}-loadorder-recommended-<timestamp>.json in ${dir}`,
        { allowReport: false },
      );
      return;
    }
    const recStamp = pattern.exec(fileName)[1];
    let recommended: any[];
    try {
      recommended = JSON.parse(fs.readFileSync(path.join(dir, fileName), "utf8"));
    } catch (error) {
      recommended = undefined;
    }
    if (!Array.isArray(recommended) || recommended.length === 0) {
      api.showErrorNotification("Can't read the recommended load order", path.join(dir, fileName), {
        allowReport: false,
      });
      return;
    }

    // The same plugins, enabled the same way, or the file is out of date
    const currentEntries = current.entries;
    const key = (entry: any) => `${entryId(entry)}|${entry?.enabled === true}`;
    const currentKeys = new Set(currentEntries.map(key));
    const recKeys = new Set(recommended.map(key));
    const added = currentEntries.filter((entry) => !recKeys.has(key(entry))).map((entry) => entry.name ?? entry.id);
    const removed = recommended.filter((entry) => !currentKeys.has(key(entry))).map((entry) => entry.name ?? entry.id);
    if (added.length > 0 || removed.length > 0 || currentEntries.length !== recommended.length) {
      api.showDialog(
        "info",
        "Recommended load order is out of date",
        {
          text:
            `${fileName} was made for a different set of plugins (or enabled states) than this profile has now. ` +
            "Wait for a check of the current export.",
          message:
            (added.length > 0 ? `New or changed here:\n  ${added.join("\n  ")}\n` : "") +
            (removed.length > 0 ? `Only in the file:\n  ${removed.join("\n  ")}` : ""),
        },
        [{ label: "Close" }],
      );
      return;
    }

    const before = currentEntries.map(entryId);
    const after = recommended.map(entryId);
    if (before.join("\n") === after.join("\n")) {
      api.sendNotification({
        type: "success",
        title: "Load order already matches",
        message: `Your load order is the same as ${fileName}: nothing to apply`,
        displayMS: 6000,
      });
      return;
    }

    // Describe each move: "<plugin>: now after <plugin before it>"
    const keep = unmoved(before, after);
    const byId: Record<string, any> = {};
    currentEntries.forEach((entry) => (byId[entryId(entry)] = entry));
    const moves = after
      .map((id, index) => ({ id, index }))
      .filter(({ id }) => !keep.has(id))
      .map(({ id, index }) => {
        const name = byId[id]?.name ?? id;
        const prev = index > 0 ? byId[after[index - 1]]?.name ?? after[index - 1] : undefined;
        return prev !== undefined ? `${name}: now loads right after ${prev}` : `${name}: now loads first`;
      });

    // The check's own summary, if it wrote one (status.json next to the file)
    let summary = "";
    try {
      const status = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));
      if (status?.stamp === recStamp && status?.summary) summary = `Check result: ${status.summary}\n\n`;
    } catch (error) {
      summary = "";
    }

    // Made for an older export than the newest one in the export folder? Then ask first
    let stale = "";
    if (settings.folder) {
      const newestExport = Object.keys(exportSets(settings.folder, gamePart, profilePart)).sort().pop();
      if (newestExport !== undefined && newestExport > recStamp)
        stale =
          `Note: this recommendation was made for the export of ${recStamp}, and there is a newer export ` +
          `(${newestExport}). The plugins still match, but you may want to wait for the newer check.\n\n`;
    }

    const apply = stale ? "Apply anyway" : "Apply";
    const answer = await api.showDialog(
      "question",
      "Apply Recommended Load Order",
      {
        text: `${moves.length} plugin(s) move. From ${fileName}.`,
        message: `${stale}${summary}${moves.join("\n")}`,
      },
      [{ label: "Cancel" }, { label: apply }],
    );
    if (answer?.action !== apply) return;

    // Keep this profile's own entry objects, in the recommended order
    const next = after.map((id) => byId[id]);
    const setFBLoadOrder = (actions as any).setFBLoadOrder;
    if (typeof setFBLoadOrder === "function") api.store.dispatch(setFBLoadOrder(profile.id, next));
    else api.store.dispatch({ type: "SET_FB_LOAD_ORDER", payload: { profileId: profile.id, loadOrder: next } } as any);

    const applied: any[] = getSafe(api.store.getState(), ["persistent", "loadOrder", profile.id], []);
    const ok = Array.isArray(applied) && applied.map(entryId).join("\n") === after.join("\n");
    log("info", `${PREFIX} applied ${fileName}: ${moves.length} move(s), ${ok ? "confirmed" : "NOT confirmed"}`);
    if (ok)
      api.sendNotification({
        type: "success",
        title: "Recommended load order applied",
        message:
          `${moves.length} plugin(s) moved.` +
          (settings.enabled ? " It will be exported for a new check in about 10 seconds." : ""),
        displayMS: 8000,
      });
    else
      api.showErrorNotification(
        "Load order not applied",
        "Vortex didn't take the new order. Import the file on the Load Order page instead: " + path.join(dir, fileName),
        { allowReport: false },
      );
  };

  // ---------- registration ----------
  context.once(() => {
    api.onAsync("did-deploy", () => {
      scheduleExport("deploy");
      return Promise.resolve();
    });
    // Load Order page (default method) and Plugins page (Classic) changes, e.g. after a LOOT sort
    api.onStateChange(["persistent", "loadOrder"], () => scheduleExport("load order change"));
    api.onStateChange(["loadOrder"], () => scheduleExport("plugins page change"));
    // A profile switch: export once its plugins.txt has been written (see pluginsMatch, 0.6.1)
    api.events.on("profile-did-change", () => scheduleExport("profile switch"));
  });

  context.registerAction("mod-icons", 999, "settings", {}, "Automatic Export Settings", editSettings);
  context.registerAction("mod-icons", 999, "upload", {}, "Export for Load Order Check Now", () =>
    exportNow("manual", true),
  );
  context.registerAction("mod-icons", 999, "swap", {}, "Apply Recommended Load Order", () => {
    applyRecommended().catch((error) =>
      api.showErrorNotification("Apply Recommended Load Order failed", error),
    );
  });
  context.registerAction("fb-load-order-icons", 999, "swap", {}, "Apply Recommended Load Order", () => {
    applyRecommended().catch((error) =>
      api.showErrorNotification("Apply Recommended Load Order failed", error),
    );
  });
};
