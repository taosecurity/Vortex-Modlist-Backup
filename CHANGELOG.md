## Changelog

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
