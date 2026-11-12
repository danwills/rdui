# rdui

A UI and contraption-building/exploring tool — and eventually a GUI framework — whose
interfaces are made of live reaction-diffusion simulations.

## Running

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
```

Needs a WebGPU browser. On Linux, Chrome/Chromium may need
`--enable-unsafe-webgpu --enable-features=Vulkan`.

## Rules

A **rule** is a set of named reagents (up to 8), named parameters and an update
formula written in [Ready](https://github.com/GollyGang/ready)'s formula language,
compiled to a WebGPU compute shader (`src/rule.ts`). Semantics match Ready: Laplacians
use the 9-point stencil (1, 4, −20)/6 on the old values, the formula may reassign
reagents and sets `delta_x`, then `x += timestep * delta_x`.

- **Built-in:** Gray-Scott, and Gray-Scott with History and Wave (a, b Gray-Scott; c a
  diffusing history; d, e a damped wave) with the "moreLifelike" parameters.
- **Ready patterns:** Dan's History-Wave family is bundled in `patterns/ready/` and
  any formula-rule `.vti` can be imported (formula, params, initial-pattern
  generator, render settings, zlib image data).
- **Paintable params:** any parameter can be made per-cell (🖌 in Global parameters,
  ✕ to make it global again; up to 7). The field is carried across the change.
- **Hidden reagents:** the view shows one reagent and can tint it by another, so
  reagents like the history c can drive behaviour without being the main display.
- **Rest state:** Erase, walls and Clear use the rule's homogeneous steady state,
  computed by relaxing a 1×1 wrapped grid (zero Laplacian).

## The sandbox

Every cell carries the rule's paintable parameters and a wall flag, so you build
contraptions by *painting* them:

| key | tool   | left drag                         | right drag / click        |
|-----|--------|-----------------------------------|---------------------------|
| 1   | Seed   | inject the rule's seed chemistry  | erase chemistry           |
| 2   | Erase  | reset reagents to rest            | —                         |
| 3   | Params | paint the paintable params        | eyedropper (sample cell)  |
| 4   | Wall   | no-flux barrier                   | remove wall               |
| 5   | Capture| drag a rectangle → new stamp      | —                         |
| 6   | Stamp  | place selected stamp (Q/E rotate, X mirror) | back to Seed    |
| 7   | Probe  | drag a rectangle → new probe      | remove probe under cursor |

Other keys: `space` run/pause · `.` single step · `[` `]` or wheel brush radius ·
`F` fill all with current params (keeps walls) · `R` reset · `C` clear chemistry · `V` cycle shown reagent ·
`T` cycle tint reagent ·
`Ctrl+S` / `Ctrl+O` save / load field · `Esc` cancel drag.

**Stamps** capture a rectangle's params, walls and chemistry, with reagent and param
names so they can be placed into other rules (matched by name). Starter stamps ship
in `stamps/*.json` (`+ Starters` adds them). They live in a library
(persisted in localStorage, exportable as JSON) and can be placed rotated/mirrored,
optionally only params+walls or only chemistry. Regions wrap around the torus.

**Probes** are rectangles measured on the GPU every few frames (mean and max of every
reagent, walls excluded), shown on the canvas and as sparklines of the shown reagent.

**Field files** (`.rdui`) hold the whole field, its rule and global values, and probes:
`RDUI` magic, version, JSON header, then raw float32 params and state. Version-1
(Gray-Scott only) files still load.

**Scenes** (`scenes/*.json`) are small declarative setups — rule, painted regions,
walls, placed stamps, probes, view — listed under *Scenes* in the rule menu.
`Glider → lamp`: a History+Wave glider lights a lamp painted with `c_damp = 0`; the
lamp keeps its history after the glider leaves while the trail elsewhere fades.

Open a specific rule or scene directly with `#rule=<id>`, e.g. `#rule=scene%3Aglider-lamp`.

The feed/kill pad in the panel plots the classic presets and the saddle-node curve;
the hover readout shows u, v and params under the cursor.

In dev builds, `window.rdui` exposes `sim`, `rule`, `globals`, `settings`, `probes`,
`stamps`, `applyRule` and `selectRule` for console tinkering.

## Layout

```
src/
  rule.ts              RuleDef, formula → WGSL compiler, initial patterns, built-in rules
  ready.ts             Ready .vti importer, bundled patterns
  scenes.ts            declarative scene format (scenes/*.json)
  sim.ts               Simulation: buffers, pipelines, step / brush / render / probe, rest relaxation
  shaders/brush.wgsl   capsule brush (seed, erase, params, wall, unwall)
  shaders/render.wgsl  palettes, parameter-map view, wall overlay
  shaders/probe.wgsl   per-region reduction (one workgroup per probe)
  probes.ts            ProbeSet: GPU measurement, async readback, history
  stamps.ts            Stamp model, rotate/mirror, thumbnails, library
  snapshot.ts          .rdui field file format
  overlay.ts           2D annotation layer (probes, drag rect, stamp ghost)
  ui.ts                side panel + feed/kill pad
  panels.ts            stamp library + probe list sections
  presets.ts           named (F, k) points
  main.ts              device setup, input, frame loop
```

## Roadmap

1. **Sandbox** — paintable multi-parameter field. *(done, first cut)*
2. **Stamps & probes** — capture/place reusable regions; GPU probes with history;
   whole-field save/load. *(done, first cut)*
3. **Rule engine** — multi-reagent formula rules, Ready import, hidden reagents,
   paintable params, scenes, starter stamps. *(done, first cut)*
4. **Widgets as attractors** (after Michael Levin's bioelectric "software on genetic
   hardware"): rules + per-cell params are the hardware, reagent state the software.
   A widget is a pattern with a slow memory of its target state that it regrows
   toward after damage; inputs are brief pulses that move it between attractors.
   - glider → lamp latch *(first cut; `c_damp = 0` is a leaky integrator — it slowly
     self-fills from the background)*
   - bistable memory reagent → a real toggle that a second glider switches off
   - damage test: erase part of a widget, check it regrows to its stored state
   - glider gun: search emitter-region parameters for periodic glider sources
5. **Bubbles** — window-like regions as a phase-field (Allen–Cahn) territory reagent:
   organic boundaries, merge on contact (or abut, with two repelling fields), close by
   biasing φ so curvature flow shrinks them away; φ gates the contents' parameters.
6. **Dragging without forcing** — chemotaxis along painted parameter gradients;
   moving the memory layer and letting the pattern regrow at the target; wave steering.
7. **Framework** — a declarative API that composes widgets into live RD-backed UIs.
8. **Mobile pass** — alt-action toggle, rotate buttons, pinch radius, slide-up panel.
