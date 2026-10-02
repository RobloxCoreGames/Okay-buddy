# Front-load washer simulator (3D, Three.js)

A single-file, physically simulated 27″ / 4.5 cu ft front-load washer, modelled on the
**LG WM4000H\*A** (2020 platform, Inverter Direct Drive, AI DD, TurboWash 360°).
It is unbranded, but the cabinet, control panel, door and internals follow the real machine's
documentation as closely as I could get from the available data.

Open `index.html` in a modern desktop browser. Three.js loads from jsDelivr, so you need an
internet connection; there is no build step.

## Quick start

1. Press **P** or click the power button.
2. Click the door (or press **D**) to open it. Add laundry from the right-hand panel, then close
   the door.
3. Click the drawer and use **Fill drawer** to add detergent.
4. Turn the knob (drag or scroll) or click a cycle name. Adjust **Temp / Spin / Soil** and the
   options on the touch display.
5. Press **Start/Pause** (or **Space**). Use **5× / 20× / 60×** to fast-forward and **X-ray** to
   see the tub, suspension, pump and plumbing.

Hold-3-second functions behave as on the real panel:
- Steam: Fresh Care
- Pre-wash: Remote Start
- Delay Wash: Wi-Fi
- Spin: Spin Only
- Rinse+Spin: Control Lock

## Why this model

The WM4000H\*A has unusually complete public documentation:
- the LG Pro-Builder spec sheet, which includes the dimension and clearance drawings
- the 180-page owner's manual (MFL71728908)
- a 54-page factory service manual (specifications, process sequence, test mode, error logic,
  component tests, exploded views, wiring diagram)
- retailer product photography from every angle

## What is simulated

| Area | Model | Source of the numbers |
|---|---|---|
| Cabinet and panel | 27″ × 39″ × 30¼″, 10° tilted drum, curved control-band seam, knob/buttons/display placement measured off the front photo (0.001089 m/px) | Spec sheet drawings, product photos |
| Control panel | 12-cycle knob with LED ring, Power and Start/Pause, touch display with Sensing/Wash/Rinse/Spin, AI DD/lock/Wi-Fi/remote icons, temp/spin/soil LED grid, 7-segment time | Owner's manual p. 22–23 |
| Cycles and options | Defaults and allowed values per cycle; option rules (Steam ✕ Cold Wash, TurboWash forbids No Spin, † auto options) | Owner's manual p. 24–30, service manual §5-2 |
| Process sequence | Lock → AI DD load sensing → fill → soak → AI DD fabric sensing → heat → wash → cooling → drain → untangling → intermittent spin → rinses → main spin → remaining spin → disentangle → End | Service manual §5-4 |
| Water-level sensor | Hydrostatic head from tub geometry → LC frequency. 25.5 kHz empty, 24.6 kHz minimum fill, 23.0 kHz suds, 21.3 kHz overflow, 10 fill levels | Service manual §2-3, §5-4, §6-3, §7-2 |
| Errors | IE (8 / 20 min), OE (10 min), UE, FE (pump drains, no power-off), PE, dE/dE1, tE, LE, Sud, uS, PF; auto power-off after 20 s or 4 min | Service manual §7-2, owner's manual p. 41–43 |
| Drive | BLDC direct drive (36-slot stator, 12 magnets), PI speed loop with torque and power limits; 46 rpm wash, 1300 rpm max; slot-harmonic motor whine | Service manual §1, §8-3 |
| AI DD | Load inertia measured from motor torque during a controlled acceleration; fabric type from the dry vs. wet mass increase | Service manual §2-2 (neuro-fuzzy) |
| Imbalance | Estimated from torque ripple at 93 rpm; up to 12 redistribution retries, then a reduced spin or UE | Service manual §5-4 steps 9–10 |
| Suspension | Tub on 2 springs and 3 friction dampers, driven by the rotating imbalance; tub-strike, cabinet shake, walking, unlevel-foot rocking | Exploded view (§10-2) |
| Laundry | Mass-spring cloth in the rotating drum frame (gravity, centrifugal, Coriolis, Euler forces, wall friction, lifters, water drag, buoyancy); absorption, spin extraction vs. g-force, soil removal | — |
| Water | Volume ↔ level from the tilted-cylinder tub; wave-equation surface with drag slosh; droplets from the fill jet, TurboWash jets, lifters, garments and spin spray; door-glass condensation | — |
| Hydraulics | Valve flow vs. supply pressure, hot/cold mixing, dispenser flushing (pre-wash/main/bleach/softener), drain-pump curve vs. hose height, kinks, clogged filter, siphoning below 29.5″ | Owner's manual p. 13 |
| Thermal | 1100 W heater interlocked on water level, thermistor lag, 45 °C door-unlock limit | Service manual §1, owner's manual p. 29 |
| Service | Load test mode (12 steps) and water-level frequency readout | Service manual §6 |

## Approximations (being honest)

- The firmware is proprietary. The timing within each step, the 6-Motion patterns and the
  AI DD decision thresholds are engineered to match the documented behaviour, not copied.
- Spin rpm for High / Medium / Low (1000 / 800 / 400) and per-cycle base wash times are
  typical values for this platform; only 1300 rpm max and 46 rpm wash are published.
- The service manual shows icons, not names, for the load-test and frequency-check button
  combos. The HUD buttons enter these modes directly.
- Cloth uses a coarse mass-spring grid (≈ 600 particles), and centrifugal force is clamped
  above about 4 g in the cloth solver because everything is pinned by then. The physics
  (extraction, imbalance, tub vibration) still uses the real rpm.
- Water is a heightfield plus ballistic droplets, not full 3D CFD.
- At high time-scales the controller and plant run at the selected speed. Load sensing and
  untangling are capped at 4× so the cloth simulation stays physically coupled.

## Reference documents used

- LG WM4000H\*A Pro-Builder spec sheet (dimensions and clearance drawings)
- LG WM4000H\*A owner's manual, MFL71728908 Rev.00
- LG WM4000H\*A series service manual (2019), sections 1–11
- Product photography (front, side, door open, drum, control-panel close-up)

The reference files themselves are not committed to this repository (they are LG's copyright).
