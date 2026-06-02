# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
本文件为 Claude Code 在此仓库中工作时提供指导。

## Running the app / 运行方式

```sh
node server.js
# 打开 http://localhost:8083/index.html
```

Python `http.server` will **not** work — MediaPipe WASM requires `SharedArrayBuffer`, enabled only with COOP/COEP headers. `server.js` adds these headers.
Python 的 `http.server` **不可用** —— MediaPipe WASM 需要 SharedArrayBuffer，仅 COOP/COEP 头下才启用。

## Deployment / 部署

Cloudflare Pages via GitHub. Configuration in `_headers` file (COOP/COEP/CORP headers injected at edge). No build step — pure static assets.
Cloudflare Pages 通过 GitHub 部署。`_headers` 文件注入 COOP/COEP/CORP 头。无构建步骤，纯静态资源。

## Architecture / 项目架构

WebGL 2D fluid simulation + MediaPipe hand gesture tracking. Single `script.js` monolith, no framework, no build step.
基于 WebGL 的 2D 流体模拟 + MediaPipe 手势追踪。单一 `script.js`，无框架，无构建。

| File | Purpose / 用途 |
|---|---|
| `index.html` | DOM, CSS, dat.GUI, local `hands.js`, promo popup, debug panel |
| `script.js` | All logic: WebGL, fluid solver, input, rendering, dat.GUI, hand tracking |
| `server.js` | Node static server with COOP/COEP/CORP headers (port 8083) |
| `dat.gui.min.js` | dat.GUI library (vendored locally) |
| `hands.js` | MediaPipe Hands API (vendored locally, no CDN) |
| `_headers` | Cloudflare Pages edge headers for SharedArrayBuffer |
| `LDR_LLL1_0.png` | Blue noise dithering texture for bloom |

### Fluid solver pipeline / 流体解算器管线

Based on Jos Stam's "Stable Fluids" (GPU Gems Ch. 38). Each frame, `step(dt)` runs on GPU via FBO ping-pong:
基于 Jos Stam "Stable Fluids" 算法。每帧通过 FBO ping-pong 在 GPU 上运行：

1. **Curl** — compute vorticity from velocity field / 计算涡量
2. **Vorticity confinement** — inject curling force (`config.CURL` = 30) / 注入涡流力
3. **Divergence** — compute velocity field divergence / 计算散度
4. **Pressure solve** — Jacobi iteration (`config.PRESSURE_ITERATIONS` = 20) / 雅可比迭代
5. **Gradient subtract** — make velocity divergence-free / 梯度消去
6. **Advection** — semi-Lagrangian back-trace for velocity and dye, with dissipation / 半拉格朗日平流

### Rendering / 渲染

1. **Bloom** — Gaussian pyramid downsample → upsample with additive blend + blue noise dithering / 高斯金字塔泛光
2. **Sunrays** — Radial blur from screen center / 屏幕中心径向模糊
3. **Display** — Composite dye + bloom + sunrays, with optional normal-map shading from density gradient / 合成+法向着色

### Input → fluid flow / 输入 → 流体

| Source / 来源 | ID range | Details / 详情 |
|---|---|---|
| Mouse / 鼠标 | `-1` | `pointers[0]`, reserved / 保留槽位 |
| Touch / 触摸 | native IDs | `pointers[1+]`, multi-touch / 多点触控 |
| Hand tracking / 手势 | `-10, -11, ...` | `handPointers[]`, via MediaPipe Hands / 摄像头手势 |

`applyInputs()` iterates `pointers[]`. `moved == true` → `splatPointer(p)` → `splat()` GPU function (Gaussian velocity+density injection at pointer UV).

### Hand tracking / 手势追踪

Camera → MediaPipe Hands (every 2nd frame, selfieMode, low detection thresholds, max 2 hands). Flow:
摄像头 → MediaPipe Hands（每2帧，自拍模式，低检测阈值，最多2手）。流程：

1. **`autoStart()`** — IIFE at page load: `checkCameraAvailability()` → `initHandTracking()` → `startCamera()`
2. **`checkCameraAvailability()`** — Uses Permissions API (`navigator.permissions.query`), no getUserMedia prompt / 使用 Permissions API 静默检测，不触发权限弹窗
3. **`startCamera()`** — Enumerates devices, filters NDI/OBS virtual cams, targets real camera by `deviceId: { exact }` / 枚举设备，过滤虚拟摄像头
4. **`initHandTracking()`** — Creates `new Hands({ locateFile: local })`, `selfieMode: true`, lowered detection thresholds (0.1), background `initialize()` / 本地文件，后台初始化
5. **`detectOpenHand()`** — Normalized avg distance of 4 non-thumb fingertips (8,12,16,20) to wrist (0) vs `HAND_OPEN_THRESHOLD` (0.35) → open → draw / 归一化指尖到手腕距离 → 张握拳判断
6. **Smoothing**: `new = old * (1 - s) + raw * s`, via `CAMERA_SMOOTHING` (0.5)
7. **Debug panel**: `#debug-panel` div updated every 30 frames with camera/detection stats / 每30帧更新诊断面板

### Coordinate conventions / 坐标约定

- Browser mouse/touch: origin top-left, Y down → GL UV (0-1, Y up) by `1.0 - posY / canvas.height`
- Camera landmarks: origin top-left, X mirrored (`1.0 - x`) for selfie view
- `correctDeltaX/Y()` compensates for non-square canvas aspect ratio

### Configuration / 配置参数

`config` object in `script.js`, exposed via dat.GUI in `startGUI()`.

| Key | Default | Range / 范围 |
|---|---|---|
| `SIM_RESOLUTION` | 256 | 128/256/512 |
| `DYE_RESOLUTION` | 1024 | 512/1024/2048 |
| `DENSITY_DISSIPATION` | 1 | 0.9–1.0 |
| `VELOCITY_DISSIPATION` | 0.2 | 0–1.0 |
| `PRESSURE_ITERATIONS` | 20 | 10–80 |
| `CURL` | 30 | 0–50 |
| `SPLAT_RADIUS` | 0.25 | 0.01–1.0 |
| `SPLAT_FORCE` | 6000 | (hardcoded / 硬编码) |
| `CAMERA_ENABLED` | **true** | checkbox |
| `CAMERA_PREVIEW` | **true** | checkbox |
| `CAMERA_SENSITIVITY` | 1.0 | 0.1–5.0 |
| `CAMERA_SMOOTHING` | 0.5 | 0–0.95 |
| `HAND_OPEN_THRESHOLD` | 0.35 | 0.15–0.5 |
| `BLOOM` | true | checkbox |
| `SUNRAYS` | true | checkbox |
| `COLORFUL` | true | checkbox |
| `SHADING` | true | checkbox |

### WebGL quirks / WebGL 特性

- WebGL2 with `EXT_color_buffer_float`; WebGL1 fallback with half-float extensions
- Float texture format chain: `R16F → RG16F → RGBA16F` (WebGL2), `RGBA` (WebGL1)
- If linear filtering unavailable: dye resolution drops to 512, shading/bloom/sunrays disabled

## Gotchas / 踩坑警告

- **Never `display:none` on `<video id="webcam">`** — MediaPipe can't read hidden video frames. Use `opacity:0` + 1×1px. / **严禁 `display:none`** —— 必须用 `opacity:0` + 1×1px。
- **`Hands.initialize()` is mandatory** — `send()` silently drops frames without it. Called in background (`.then/.catch`). / **必须调用 `initialize()`** —— 否则 `send()` 静默丢弃帧。
- **COOP/COEP headers mandatory** — `server.js` for local dev, `_headers` for Cloudflare Pages. `file://` protocol will not work. / **COOP/COEP 头必须** —— 本地用 `server.js`，部署用 `_headers`。
- **Virtual camera filtering** — NDI/OBS cameras skipped in `startCamera()` by label check. / **虚拟摄像头过滤** —— `startCamera()` 通过标签过滤。
- **All MediaPipe files are local** — No CDN dependency. 7 files (~16MB): hands.js, WASM, tflite, binarypb, asset data/loader.
- **No `package.json`** — Missing intentionally to prevent Cloudflare Pages from running Wrangler/npm install. / **无 `package.json`** —— 故意不创建，防止 Cloudflare Pages 自动安装 Wrangler 依赖。
