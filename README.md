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

## The sandbox (milestone 1)

A GPU Gray-Scott field where every cell carries its own parameters
`(feed, kill, diffusionScale, wall)`, so you build contraptions by *painting* them:

| key | tool   | left drag                         | right drag / click        |
|-----|--------|-----------------------------------|---------------------------|
| 1   | Seed   | inject chemical V                 | erase chemistry           |
| 2   | Erase  | reset to U=1, V=0                 | —                         |
| 3   | Params | paint feed / kill / diffusion     | eyedropper (sample cell)  |
| 4   | Wall   | no-flux barrier                   | remove wall               |

Other keys: `space` run/pause · `.` single step · `[` `]` or wheel brush radius ·
`F` fill all with current params (keeps walls) · `R` reset · `C` clear chemistry · `V` cycle view.

The feed/kill pad in the panel plots the classic presets and the saddle-node curve;
the hover readout shows u, v and params under the cursor.

In dev builds, `window.rdui.sim` / `window.rdui.settings` are exposed for console tinkering.

## Layout

```
src/
  sim.ts               Simulation: buffers, pipelines, step / brush / render / probe
  shaders/step.wgsl    Gray-Scott Euler step, 9-point Laplacian, no-flux walls, toroidal edges
  shaders/brush.wgsl   capsule brush (seed, erase, params, wall, unwall)
  shaders/render.wgsl  palettes, parameter-map view, wall overlay
  ui.ts                side panel + feed/kill pad
  presets.ts           named (F, k) points
  main.ts              device setup, input, frame loop
```

## Roadmap

1. **Sandbox** — paintable multi-parameter field. *(done, first cut)*
2. **Stamps & probes** — save/load regions (params + walls + state) as reusable components;
   attach probes that read region averages over time; snapshot save/load.
3. **Widgets** — RD button, toggle, slider, display; wire probes/injectors to app state.
4. **Framework** — a declarative API that composes widgets into live RD-backed UIs.
