## Changelog

#### Version 0.6.1
 * An automatic export now waits until plugins.txt matches the profile's enabled plugins (checking every 5 seconds for up to a minute). After a profile switch Vortex rewrites plugins.txt a little after the rest, so an export could carry the previous profile's plugins.txt. If it never matches, the set is written anyway with a warning; a manual export shows the same warning
 * A profile switch now triggers an automatic export too

#### Version 0.6.0
 * Automatic export (off until you turn it on in **Automatic Export Settings**): about 10 seconds after each deploy or load order change, the active profile's modlist, load order and a copy of plugins.txt are written to a folder you pick, all three with the same timestamp (`vortex-<game>-<profile>-plugins-<timestamp>.txt` for plugins.txt). Unchanged sets aren't written again, and older sets move to an `old` folder. **Export for Load Order Check Now** does it on demand
 * **Apply Recommended Load Order** reads the newest `vortex-<game>-<profile>-loadorder-recommended-<timestamp>.json` from a folder you pick, shows which plugins move, and sets the Load Order page's order when you confirm. It refuses when the plugins no longer match, and asks first when the file is older than the newest export
 * Log lines start with `[MLB]` in Vortex's log

#### Version 0.5.4
 * Each mod in a backup now records `version` (the version Vortex shows) and `archive` (the file it was last installed from). Vortex keeps a mod's folder name (`vortexId`) and its old Nexus file ID when you install a newer archive over it, so before this a backup could show an old version for a mod you'd already updated. Both fields are for information only; Restore doesn't use them

#### Version 0.5.3
 * Backups now include mods installed from a file on disk (no Nexus mod or file ID), so the backup lists the same mods as the Mods page. They're marked `"source": "local"`, and Restore skips them and says how many it skipped
 * Each mod in a backup now lists its plugin files (`.esm`, `.esp`, `.esl`) under `plugins`. Mods with no plugins, like SFSE or DLL mods, have an empty list

#### Version 0.5.2
 * Backing up a profile's load order now saves the order the game really uses. Starfield's "Rules-based (Classic)" method keeps its order on the Plugins page, but 0.5.1 always saved the Load Order page's list, which stops changing when you switch to Classic, so the backup was out of date. The Classic order is saved as vortex-<game>-<profile>-loadorder-classic-backup-<timestamp>.json, and the notification says which page the order came from
 * Games that only use the Plugins page (like Skyrim) now get a load order backup too, instead of a warning

#### Version 0.5.1
 * Renamed to "Modlist and Load Order Backup", and the toolbar buttons are now Restore Modlist, Back Up Modlist (All Games), Back Up Modlist (This Game) and Back Up Modlist and Load Order (This Profile)
 * Backing up "Only This Profile" also saves the profile's load order to a second file next to the modlist, like vortex-starfield-Default-loadorder-backup-20261026-212500.json. It's the same format as the Export button on Vortex's Load Order page, so you can restore it with that page's Import button
 * Each toolbar button now has its own icon, instead of all four showing the same eye icon
 * Backups now default to a file name saying what was backed up and when, like vortex-starfield-modlist-backup-20261026-212500.json
 * Fixed installing in current versions of Vortex, which rejected the extension because of how its author was listed

#### Version 0.5.0
 * Backing up all games over an existing backup now replaces it, instead of only updating the game you're managing
 * Backups now record whether mods are enabled using each game's own profile, so restoring a game no longer disables mods that were backed up while managing a different game
 * Backups now record which game each mod was installed into, so mods a game uses from another game (like Skyrim mods in Skyrim Special Edition) are backed up and restored with the right game
 * Backing up asks before replacing an existing file, and won't overwrite a file that isn't a modlist backup
 * Backups are saved safely, so a crash while saving can't leave a half written backup
 * Backing up or restoring with no game managed shows an error instead of failing
 * Choosing "Yes, download and install" when restoring now installs the mods, and you're only asked when there's something new to install
 * Restoring an unreadable or invalid backup file shows an error instead of failing silently
 * Mods that fail to download while restoring are reported
 * The notification after restoring now says how many mods were queued and how many were enabled or disabled

#### Version 0.4.0
 * There's a new option to only backup mods enabled in the current profile
 * Backup files created from now on will contain information on whether or not the mod was enabled in the current active profile
 * If you restore a mod from a backup made from this version onwards, it won't enable mods that were disabled when backed up

#### Version 0.3.2
 * Ask the user if they want to install the mods when they have auto-install disabled in the settings

#### Version 0.3.1
 * Cancelling the file selector for creating or restoring backups no longer causes an error (#3)
 * Trying to save to an already existing blank text file will no longer cause an error (#5)

#### Version 0.3.0
 * Added the ability to backup the mods for just one game
 * Filtered out the backup output to remove mods that have no modId or fileId
 * Added support for a newer version of Vortex

#### Version 0.2.0
 * Moved to Typescript
 * Changed error popups to success notifications
 * Backuping up modlist no longer removes mods from games that aren't part of Vortex anymore

#### Version 0.1.1
 * Added a file selector to choose where to back up to and restore from

#### Version 0.1.0
 * First release
