# CH-1 Chiller Plant Simulator

`index.html` is a single-file Three.js walk-through of a school mechanical room with a physically simulated 250-ton split screw chiller. The compressor-chiller is indoors and its 14-fan air-cooled condenser is on the roof. Open the file in a desktop browser. Three.js loads from jsDelivr.

## What the model is based on

The real plant is a Trane split system: an indoor evaporator with two screw compressors and a Trane remote condenser on the roof. That matches Trane's **Model RTUD** compressor-chiller: 80–250 tons, two helical-rotary compressors (one per circuit) and an evaporator, piped to a remote air-cooled condenser with 2–8 fans per circuit, running Tracer CH530 controls. The sequences below follow Trane's installation and operation manual for that unit (RLC-SVX09K-EN).

**From the Trane manual:**
- **Stopped → Starting:** Auto energizes the evaporator pump relay, then flow is confirmed (6 s filter). After a call for cooling (differential to start), the chiller waits for oil (up to 2 min), pre-positions the EXV (≤ 15–20 s), sets condenser fan pre-flow by outdoor temperature, then starts the lead compressor.
- **Wye-delta closed-transition starter:** the transition happens when motor current falls below 85% RLA (motor up to speed), or when the maximum acceleration timer runs out.
- **Capacity:** each compressor starts at minimum (unload solenoid on). It then steps to its step-load point with the female-step solenoid, and the slide valve modulates above that with load/unload solenoids. Capacity-control softload applies.
- **Limits and overrides:** "Establishing Min Cap – Low Diff Pressure", the hot-start limit, high condenser pressure limit, low evaporator refrigerant temperature limit, and current limit.
- **EXV:** controls the **evaporator liquid level**, with an override for low evaporator pressure.
- **Normal shutdown:** a 5 s run-unload, then an operational pumpdown (only below 50 °F outdoors or EWT + 5 °F; 2 min max), compressor off, condenser fans off, then the evaporator pump off-delay before the pump relay opens.
- **Restart:** restart inhibit, balanced starts/hours lead-lag, and the differential to start/stop set points.
- **Protections:** low refrigerant temperature cutout (28.6 °F), low leaving water cutout (36 °F), high pressure cutout and loss of flow.

**Inferred from field observation (not in the Trane manual):**
- **The BAS program:** it enables the chiller and starts the secondary-pump VFD after CHWP-1 is proven. On unoccupied it drops the VFD to 20% and removes the chiller enable a minute later.
- **What the VFD drives:** modelled as the secondary pump.
- **Set points:** the condenser fan staging target, softload (120 s) and evaporator pump off-delay (2 min) are set to match what was heard.

## Sound

The compressor sound is synthesized, not sampled. It matches a recording of the real compressor running unloaded:
- **Main tone:** a lobe-passing tone at 5 × shaft speed (≈298 Hz). The male rotor has 5 lobes.
- **Harmonics:** strong odd harmonics (3rd −6 dB, 5th −19, 7th −30, 11th −39, 13th −40) and weak even ones.
- **Flutter:** an amplitude flutter at the 7-lobe female rotor speed (≈42.6 Hz).
- **Pump:** the chilled water pump's vane-pass tone (7 vanes × 29.7 Hz ≈ 208 Hz) comes from the same recording.

When the step-load solenoid moves the compressor off minimum, the gas pulsation drops and the compressor gets much quieter.

## Things to click

| Location | What it does |
| --- | --- |
| Unit control panel | Touch-screen operator display (Auto/Stop, reports per circuit, settings, diagnostics with reset) and the emergency stop |
| BAS touchscreen | Occupancy, CHW set point, outdoor-air override, sim speed (1–30×), condenser fan view, trends, alarms |
| Electrical | CHWP-1 HOA selector, VFD Hand/Off/Auto keys, CH-1 disconnect, MSB main breaker (blackout and restart), condenser fan disconnect |
| Valves | Evaporator isolation valve (loss of flow), liquid-line service ball valves (starve a circuit) |
