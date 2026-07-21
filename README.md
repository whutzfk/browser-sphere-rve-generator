# Browser Sphere RVE Generator


Open the web tool directly:


**https://whutzfk.github.io/browser-sphere-rve-generator/**


This is the public browser version. Users do **not** need Codex, Git, Node.js, or a local installation to use it.


Standalone browser generators for sphere-inspired porous RVE models.


This repository packages two browser tools derived from `whutzfk/sphere-2d-rve` and `whutzfk/sphere-3d-rve`:


- `browser-sphere-2d-rve-generator`: 2D circle-clipped pore RVE generator with SVG, PNG, DXF, and graph CSV exports.
- `browser-sphere-3d-rve-generator`: 3D sphere-clipped pore RVE generator with WebGL preview plus STL, OBJ, and graph CSV exports.


## Repository Type


- Type: `Browser Tool`
- Public app: GitHub Pages
- Codex required: No
- Related Codex skills: `whutzfk/sphere-2d-rve`, `whutzfk/sphere-3d-rve`


## Run


From the repository root:


```powershell
npm run dev
```


Open:


```text
http://localhost:3000
```


The root page links to both generators.


You can also run either tool directly:


```powershell
cd .\browser-sphere-2d-rve-generator
node .\tools\dev-server.js
```


```powershell
cd .\browser-sphere-3d-rve-generator
$env:PORT=3001
node .\tools\dev-server.js
```


## Notes


- The tools run entirely in the browser.
- No build step is required.
- Downloads are generated locally in the browser.
- The 2D tool includes COMSOL-oriented DXF export and MATLAB graph CSV export.
- The 3D tool includes STL/OBJ mesh export and node/edge/face CSV export.

