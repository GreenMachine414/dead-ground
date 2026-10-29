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
| `npm test` | Headless simulation tests: bots play every map in story and endless modes, every boss uses its signature abilities, and the co-op stress test runs (`npm run stress` on its own): downs, revives, bleed-outs, team wipes, players leaving mid-revive or with the forge/box in use, every ability at once, 4-player boss fights, malformed network input, and the cost of a 4-player tick and snapshot |
| `npm run stress:live` | Live 4-player co-op test: starts four copies of the game on this PC (a host and three guests joining by IP), each played by a bot, through ready-up, a boss round, downs and revives (of a guest and of the host), a guest leaving mid-game and End Game for Everyone. Prints each copy's frame rate, network rate and checks |
| `npm run smoke` | Launches the real app and drives it automatically. It plays all 5 maps, tests host/client networking (including joining by game code) and saves screenshots to `test/shots/` |
| `npm run crashtest` | Causes real errors and a real crash of the game's page, and checks each is logged in My reports, sent once (repeats and offline sends included) and noted on the error popup. Sends nothing; `node scripts/run.js --crashtest=live` really sends two test reports |
| `npm run perf` | Frame-rate benchmark on the heaviest maps with a big horde. Prints average FPS, 1% lows and the GPU status. Add `-- --vector` to compare against uncached prop drawing |
| `npm run trailer` | Records a 45-second 1080p advertisement to `release/Dead Ground Trailer.mp4`. Bots play real rounds (the game's own waves), with captions, the Weapon Forge, an abilities showcase and a helicopter extraction finale. A borderless window plays for a few minutes; nothing plays through the speakers |
| `npm run finale` | Records the end-of-story cutscene to `release/Dead Ground Finale.mp4` (about 35 seconds at 1080p) |
| `npm run dist` | Builds a Windows portable `.exe` and an installer into `release/` |

Save data (progress, upgrades, settings) lives in `%APPDATA%\zombie-survival\profile.json`.

## Content

- **5 story maps** that unlock in order. Each has its own story objectives, unique zombies, new weapons and a boss:
  1. Harvest Farm: radio parts, repair the radio, survive. Boss: The Harvester (scythe sweep, chain hook that drags you in)
  2. Dead End Downtown: Brute mini-boss carries the keycard, restore power, defend the subway. Boss: The Abomination (acid bile trail, devours its own minions to heal)
  3. Fort Ironside: demolition charges, rig the bridge, Juggernaut mini-boss, survive. Boss: Iron General (artillery barrage on every player, rallies nearby zombies)
  4. Whiteout Station: generator, tissue samples, centrifuge, Twin Brutes. Boss: The Hive Queen (lays egg sacs that hatch into leapers unless destroyed)
  5. Ground Zero: reactors, antidote vials, defend the lab, Juggernaut. Boss: Patient Zero (splits into look-alike decoys, life-drain beam, enrages). Extracting plays a finale cutscene: the team's getaway truck fights through the horde, blows the bridge behind them and drives into the sunrise, then a thank-you card, all to a synthesized heavy rock score (Esc skips). Once beaten, **Watch the Finale** under the map list replays it
- **Endless Survival** on any unlocked map. A boss appears every 5 rounds and a mini-boss every 3 rounds after round 6.
- **13 weapons**, introduced across the maps: pistol, revolver, shotgun, SMG, AR, grenade launcher, crossbow, sniper, flamethrower, LMG, Plasma Ray, Storm Caller (chain lightning) and minigun.
- **6 characters**, each with an ability you can upgrade to level 5 using Salvage earned in games:
  - Brick: walls
  - Sparks: sentry turrets
  - Doc: healing field and revives
  - Rook: airstrike
  - Volt: chain lightning
  - Mags: drops supply bags around himself; each bag restocks one teammate who is short on ammo (passive: +25% reserve ammo)
- **Loot:** guns aren't lying around. You find them by searching weapon racks, lockers, supply crates, car trunks, fallen survivors and toolboxes (hold E at the ✦ sparkle). Each gun rolls a rarity from Common to Legendary, which raises damage, magazine size and reload speed. Military chests always roll Rare or better, and searched containers sometimes restock between rounds.
- **Upgrade Machine:** every map has one (purple diamond on the minimap). Pay points to choose 1 of 3 upgrades (1/2/3 or click); the price rises with each purchase and picks stack for the rest of the run. Solo play pauses while you choose. Upgrades include Aegis (recharging shield), Last Stand (self-revive), Overcharge (stronger ability) and Thorns. Kills still earn XP and levels, shown on the scoreboard.
- **COD-style systems:** rounds, points, Mystery Box, 4 perk machines, debris doors, a Weapon Forge on maps 3–5 (pack-a-punch: X costs 5000 and gives a violet finish with a sparkling aura and violet shots; XX costs 10000 and unlocks after 100 kills with the X gun, turning it all crimson; X deals ×1.5 and XX ×2 the gun's damage, and bosses take half the bonus) and power-ups (Max Ammo, Insta-Kill, Double Points, Kaboom). Machine names appear above them as you approach. Zombies claw up out of the ground when they spawn.
- **Music:** a procedural score. The main theme plays in the menus and lobby only. Each map has its own song and instruments: banjo and whistle on the farm, swung electric piano and muted trumpet downtown, strings, horn and military snare at the fort, glass bells and wind at the station, and a dark synth pulse with metal clanks at the lab. Songs stay calm while you explore and bring in bass and drums during rounds. When any boss or mini-boss appears, every map switches to the same battle music (driving strings, taiko, brass, choir and an alarm line), which holds a few seconds after the last boss falls.
- **Bug Reports/Feedback** (bottom right of the main menu): players write up to 1000 characters, which are emailed to the developer through Web3Forms. The address is stored on Web3Forms, not in the game. Vulgar language is blocked, there's a 30-second wait between sends, and players can reopen and edit their last 20 reports (each edit arrives as a new email with the same report number). Smoke runs never send. Errors and crashes are reported automatically: the error popup says the error was logged and is being investigated, the report (what went wrong, where, and the stack, without the player's folder names) appears in My reports, repeats of one error are sent once and at most 3 per session, and reports made offline are sent on the next launch. After a crash the game restarts by itself and reports it.
- **Co-op for up to 4 players.** Zombie count and health scale with the number of players. Downed players can be revived within 45 seconds. Solo players get one automatic "Second Wind" per game.

## Co-op

1. The host clicks **Host Co-op**. The lobby shows a 6-character **game code** (click **Copy** to copy it).
2. Friends click **Join Co-op**, type the code and click **Join**.
3. Everyone picks a survivor and clicks **Ready Up**. The host can start once every friend is ready (changing your survivor, or the host changing the map or mode, clears ready).

That works the same on the same Wi-Fi or across the country. Players connect peer-to-peer over WebRTC, using the free PeerJS service only to find each other, so there's no port forwarding or VPN to set up. Everyone needs an internet connection.

**No internet?** Players on the same network can still join by IP. The lobby also shows the host's LAN address, and the Join screen has a "Join by IP address instead" section (TCP port **27015**; allow the app through Windows Firewall when asked).

To test on one PC, run `npm start` twice and join with the code from the second window.

## Graphics and performance

Settings → **Graphics** offers **Auto** (default), **High** and **Low**. Auto watches the frame rate and lowers render resolution and particle counts when the game can't keep up with the display, then raises them again when there's headroom. Low is the fastest option for weak laptops.

Settings → **Fullscreen** (or F11) switches to fullscreen and is remembered for the next launch.

## Controls

WASD move · Mouse aim · Left click shoot · Shift sprint · R reload · Q / 1 / 2 swap weapon · 1 / 2 / 3 pick a level-up card · F or right click ability · G grenade · V knife · E interact (hold to search, revive or activate) · Tab scoreboard · M map · Mouse wheel zoom · Esc pause · F11 fullscreen

Every key except 1 / 2 / 3, Esc and F11 can be changed in Settings → Controls (arrow keys always move too).

## Code layout

- `electron/`: main process (window, save file, the WebSocket relay used for direct-IP LAN play)
- `src/game/`: the simulation, which runs headless in Node. It covers AI, bosses, weapons, abilities, waves, story, physics and the flow-field pathfinding.
- `src/data/`: maps (layouts and stories), weapons, zombies, characters
- `src/render/`: the 2D renderer (`renderer.js`), hand-drawn sprite functions (`sprites.js`) and the pre-rendered ground painter (`groundpaint.js`)
- `src/music.js`: the procedural music sequencer
- `src/session.js`: the game loop for solo, host and client. Clients predict their own movement locally.
- `src/net.js`: networking. Game-code joins over WebRTC (PeerJS), plus the direct-IP relay fallback
- `src/main.js`: menus, lobby, upgrades and the end-of-game screen
