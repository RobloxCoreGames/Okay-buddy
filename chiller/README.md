# CH-1 Chiller Plant Simulator

`index.html` is a single-file Three.js walk-through of a school mechanical room. It contains a physically simulated 250-ton split screw chiller: the evaporator and compressors are indoors, and an air-cooled condenser with 14 fans sits on the roof. Open the file in a desktop browser. Three.js loads from jsDelivr.

## What is simulated

- **Refrigerant (R-134a), per circuit.** Saturation pressure, vapor density, latent heat, and liquid enthalpy and density come from curve fits to NIST data. The suction and condensing states come from mass and energy balances. Liquid inventory moves between the flooded cooler, the liquid line and the condenser, and that sets subcooling and sight-glass flashing.
- **Twin-screw compressors.** The slide valve runs from 40% to 100% and is moved hydraulically by the loader solenoids. Built-in volume ratio depends on slide position, and the over- or under-compression mismatch costs both power and noise. Volumetric efficiency, shaft torque, discharge superheat and motor temperature are modelled, along with a motor-cooling solenoid.
- **Wye-delta starting.** The induction motors use an equivalent-circuit model (torque and current versus slip). The 1M+S → 2M open transition runs on the real bus impedance, so the room lights dim twice on every start.
- **Controls following the Carrier 30HXA controls manual.** Oil-pump prelube is 20 s, then the oil solenoid opens, then 15 s more. The EXV holds a 22 °F discharge superheat set point. A 30-second capacity algorithm does the staging, with the 90-s step delay, ramp loading, low-superheat, low-SST, high-SCT and low-EWT overrides. The 7 fans per circuit are switched by fan-cycling pressure and ambient switches. When the unit is disabled it runs a pumpdown.
- **Field-programmed BAS.** The across-the-line primary pump starts first. The secondary pump's VFD ramps up 20 s later on differential-pressure control. Then the chiller enable closes. At stop, the VFD drops to minimum, the chiller pumps down, and the pump turns off after its off-delay.
- **Water side and building.** The plant is primary/secondary with a decoupler, loop thermal mass, AHU coil valves and a building zone with a daily outdoor-air cycle.
- **Sound.** All of it is synthesized from simulator state with Web Audio and positioned in 3D. The compressor roar follows slide-valve bypass and pulsation, and its tone tracks the 4-lobe rotor passing frequency. The VFD whine tracks output frequency. Contactors, solenoids and the pump start each have their own sound.

## Things to click

| Location | What it does |
| --- | --- |
| Chiller control box | Enable/Off/Remote switch, emergency switch, display module keys (scroll through points; ENTER on the last page resets alarms) |
| Display module | Shows unit status, pressures, temperatures, discharge superheat, EXV position and loader state |
| BAS touchscreen | Occupancy, CHW set point, outdoor-air override, sim speed (1–30×), roof condenser view, trends, alarms |
| Electrical | CHWP-1 HOA selector, VFD Hand/Off/Auto keys, CH-1 disconnect, MSB main breaker (blackout and restart), condenser fan disconnect |
| Valves | Evaporator isolation valve (causes a flow-loss trip), liquid-line ball valves (starve a circuit) |

## Sources

- Carrier *30HXA,HXC076-271 Product Data* (Form 30HX-14PD): dimensions, unit layout, wye-delta option, remote-condenser requirements, minimum loop volume.
- Carrier *30HXA,HXC076-271 Controls, Start-Up, Operation, Service and Troubleshooting* (Series 7): oil-pump and wye-delta sequence, EXV and discharge-superheat control, capacity algorithm and overrides, 09D fan-cycling switch settings, pumpdown, alarm codes.

The real plant's start/stop timing was matched to field observations of the installed system. Which load the VFD drives was not known, so here it is modelled as the secondary distribution pump.
