# Dead Ground

A top-down co-op zombie survival game in the style of COD Zombies, with a cozy hand-drawn 2D RPG look. It runs as a Windows desktop app built with Electron and a Canvas 2D renderer. All art and music are generated in code, so there are no asset files.

## Run it

```
npm install
npm start
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm start` | Build and launch the game |
| `npm run dev` | Launch with DevTools open |
| `npm test` | Headless simulation test: bots play every map in story and endless modes |
| `npm run smoke` | Launches the real app and drives it automatically. It plays all 5 maps, tests host/client networking and saves screenshots to `test/shots/` |
| `npm run dist` | Builds a Windows portable `.exe` and an installer into `release/` |

Save data (progress, upgrades, settings) lives in `%APPDATA%\zombie-survival\profile.json`.

## Content

- **5 story maps** that unlock in order. Each has its own story objectives, unique zombies, new weapons and a boss:
  1. Harvest Farm: radio parts, repair the radio, survive. Boss: The Harvester
  2. Dead End Downtown: Brute mini-boss carries the keycard, restore power, defend the subway. Boss: The Abomination
  3. Fort Ironside: demolition charges, rig the bridge, Juggernaut mini-boss, survive. Boss: Iron General
  4. Whiteout Station: generator, tissue samples, centrifuge, Twin Brutes. Boss: The Hive Queen
  5. Ground Zero: reactors, antidote vials, defend the lab, Juggernaut. Boss: Patient Zero (enrages)
- **Endless Survival** on any unlocked map. A boss appears every 5 rounds and a mini-boss every 3 rounds after round 6.
- **13 weapons**, introduced across the maps: pistol, revolver, shotgun, SMG, AR, grenade launcher, crossbow, sniper, flamethrower, LMG, Plasma Ray, Storm Caller (chain lightning) and minigun.
- **5 characters**, each with an ability you can upgrade to level 5 using Salvage earned in games:
  - Brick: walls
  - Sparks: sentry turrets
  - Doc: healing field and revives
  - Rook: airstrike
  - Volt: chain lightning
- **Loot:** guns aren't lying around. You find them by searching weapon racks, lockers, supply crates, car trunks, fallen survivors and toolboxes (hold E at the ✦ sparkle). Each gun rolls a rarity from Common to Legendary, which raises damage, magazine size and reload speed. Military chests always roll Rare or better, and searched containers sometimes restock between rounds.
- **In-match levels:** kills earn XP. Each level offers 3 upgrade cards (1/2/3 or click), and picks stack for the rest of the run. Solo play pauses while you choose.
- **COD-style systems:** rounds, points, Mystery Box, ammo caches, 4 perk machines, debris doors, a Weapon Forge (pack-a-punch) and power-ups (Max Ammo, Insta-Kill, Double Points, Kaboom). Zombies claw up out of the ground when they spawn.
- **Music:** a procedural melodic score with its own key, tempo and melody for each map. It stays calm while you explore, adds bass and drums during rounds, and builds further for bosses.
- **Co-op for up to 4 players.** Zombie count and health scale with the number of players. Downed players can be revived. Solo players get one automatic "Second Wind" per game.

## Co-op

1. The host clicks **Host Co-op**. The lobby shows their IP address and port (TCP **27015**).
2. Friends click **Join Co-op** and enter that address.
   - **Same network:** use the host's local IP (the one shown in the lobby).
   - **Over the internet:** the host forwards TCP 27015 on their router and shares their public IP. Easier option: everyone installs a virtual-LAN tool such as Tailscale, ZeroTier or Radmin VPN and uses the host's IP on that network.
   - Windows Firewall will ask the host to allow the app the first time they host. Allow it.
3. To test on one PC, run `npm start` twice and join `127.0.0.1` from the second window.

## Controls

WASD move · Mouse aim · Left click shoot · Shift sprint · R reload · Q / 1 / 2 swap weapon · 1 / 2 / 3 pick a level-up card · F or right click ability · G grenade · V knife · E interact (hold to search, revive or activate) · Tab scoreboard · Mouse wheel zoom · Esc pause · F11 fullscreen

## Code layout

- `electron/`: main process (window, save file, the WebSocket relay used for hosting)
- `src/game/`: the simulation, which runs headless in Node. It covers AI, bosses, weapons, abilities, waves, story, physics and the flow-field pathfinding.
- `src/data/`: maps (layouts and stories), weapons, zombies, characters
- `src/render/`: the 2D renderer (`renderer.js`), hand-drawn sprite functions (`sprites.js`) and the pre-rendered ground painter (`groundpaint.js`)
- `src/music.js`: the procedural music sequencer
- `src/session.js`: the game loop for solo, host and client. Clients predict their own movement locally.
- `src/main.js`: menus, lobby, upgrades and the end-of-game screen
