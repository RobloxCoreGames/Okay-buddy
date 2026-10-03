# Steam Plant Operator

A 3D, physically simulated 36 MW gas-fired drum boiler and steam turbine unit, built with three.js.

Open `index.html` in Chrome or Edge. It needs an internet connection because three.js and the fonts load from CDNs.

- **Physics:** IAPWS-IF97 steam tables, Åström–Bell drum dynamics with shrink and swell, combustion with excess air, O₂, CO and NOx, superheater metal temperatures, and turbine expansion with an isentropic efficiency.
- **Turbine and generator:** a swing-equation generator on the grid, plus condenser vacuum with air in-leakage, the deaerator and the feed pumps.
- **Controls:** NFPA-style burner management (purge, pilot, main flame), a three-element drum level controller, a DEH governor, and a synchroscope with auto-sync.
- **Operator tools:** an annunciator, trends, procedures, and an instructor station with faults.
- **Sound:** procedural, spatialized Web Audio.

Source is in `src/`. After editing it, rebuild the single-file page with `node tools/build.mjs`. `tools/gen_steam_tables.py` regenerates `src/steamtables.js`.
