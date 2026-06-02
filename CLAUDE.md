# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
本文件为 Claude Code 在此仓库中工作时提供指导。

## Running the app / 运行方式

```sh
node server.js
```

Then open `http://localhost:8083/index.html`.
然后打开 `http://localhost:8083/index.html`。

Python's `http.server` will **not** work — MediaPipe's WASM requires `SharedArrayBuffer`, which browsers only enable when the server sends COOP/COEP headers. `server.js` adds these headers automatically.
Python 的 `http.server` **不可用** —— MediaPipe 的 WASM 需要 `SharedArrayBuffer`，浏览器仅在服务器发送 COOP/COEP 头时才启用此特性。`server.js` 会自动添加这些头。

## Architecture / 项目架构

WebGL 2D fluid simulation with hand gesture tracking.
基于 WebGL 的 2D 流体模拟，支持手势追踪。

| File / 文件 | Purpose / 用途 |
|---|---|
| `index.html` | DOM, CSS, dat.GUI, local MediaPipe script, promo popup, debug panel / DOM结构、样式、dat.GUI、本地MediaPipe脚本、推广弹窗、调试面板 |
| `script.js` | All logic: WebGL, fluid solver, input handling, rendering, dat.GUI config, hand tracking, debug panel / 全部逻辑 |
| `server.js` | Node static server with COOP/COEP/CORP headers for SharedArrayBuffer / Node静态服务器 |
| `dat.gui.min.js` | dat.GUI library (vendored locally) / dat.GUI库（本地化） |
| `hands.js` | MediaPipe Hands API (vendored locally) / MediaPipe Hands API（本地化） |

### Fluid solver pipeline / 流体解算器管线

Based on Jos Stam's "Stable Fluids" (GPU Gems Ch. 38). Each frame, `step(dt)` runs on GPU via FBO ping-pong:
基于 Jos Stam "Stable Fluids" 算法。每帧通过 FBO ping-pong 在 GPU 上运行：

1. **Curl** — compute vorticity from velocity field / 从速度场计算涡量
2. **Vorticity confinement** — inject curling force (`config.CURL` = 30) / 注入涡流力
3. **Divergence** — compute divergence of velocity field / 计算速度场散度
4. **Pressure solve** — Jacobi iteration (`config.PRESSURE_ITERATIONS` = 20) / 雅可比迭代压力求解
5. **Gradient subtract** — make velocity divergence-free / 梯度消去
6. **Advection** — semi-Lagrangian back-trace for velocity and dye, with dissipation / 半拉格朗日回溯平流

### Rendering / 渲染

1. **Bloom** (optional): Gaussian pyramid downsample → upsample with additive blend / 泛光（可选）
2. **Sunrays** (optional): Radial blur from screen center / 太阳光线（可选）
3. **Display**: Composite dye + bloom + sunrays, with optional normal-map shading / 合成显示+法向贴图着色

### Input → fluid flow / 输入 → 流体

All input maps to `pointerPrototype` objects in `pointers[]` array:
所有输入映射为 `pointers[]` 数组中的 `pointerPrototype` 对象：

| Source / 来源 | ID range / ID范围 | Details / 详情 |
|---|---|---|
| Mouse / 鼠标 | `-1` | `pointers[0]`, reserved slot / 保留槽位 |
| Touch / 触摸 | native touch IDs | `pointers[1+]`, multi-touch / 多点触控 |
| Hand tracking / 手势 | `-10, -11, ...` | `handPointers[]`, via MediaPipe Hands / 摄像头手势识别 |

### Hand tracking module / 手势追踪模块

Camera → MediaPipe Hands (every 2nd frame, 640x480, model complexity 1, selfieMode) → `onHandResults()` callback:
摄像头 → MediaPipe Hands（每2帧，640×480，模型复杂度1，自拍模式）→ `onHandResults()` 回调：

1. **Camera acquisition / 摄像头获取** (`startCamera()`): Enumerates devices, filters NDI/OBS virtual cameras, targets real camera by `deviceId: { exact }`. / 枚举设备，过滤虚拟摄像头。
2. **Hands initialization / Hands 初始化** (`initHandTracking()`): Local `locateFile`, `selfieMode: true`, low detection thresholds, background `initialize()`. / 本地文件，低检测阈值，后台初始化。
3. **Open/closed detection / 张握拳检测** (`detectOpenHand()`): Normalized avg distance of 4 non-thumb fingertips to wrist. If > `HAND_OPEN_THRESHOLD` (0.35) → open → draw. / 归一化指尖到手腕距离，大于阈值则张开→绘制。
4. **Smoothing / 平滑**: `new = old * (1 - s) + raw * s`, via `CAMERA_SMOOTHING` (0.5).
5. **Debug panel / 调试面板**: `#debug-panel` div updated every 30 frames. / 每30帧更新显示状态。

### Configuration / 配置参数

`config` object in `script.js`, exposed via dat.GUI in `startGUI()`.
通过 dat.GUI 暴露。

| Key / 键 | Default / 默认值 | Range / 范围 |
|---|---|---|
| `SIM_RESOLUTION` | 256 | 128/256/512 |
| `DYE_RESOLUTION` | 1024 | 512/1024/2048 |
| `PRESSURE_ITERATIONS` | 20 | 10–80 |
| `CURL` | 30 | 0–50 |
| `SPLAT_FORCE` | 6000 | (hardcoded / 硬编码) |
| `CAMERA_ENABLED` | true | checkbox |
| `CAMERA_PREVIEW` | true | checkbox |
| `CAMERA_SENSITIVITY` | 1.0 | 0.1–5.0 |
| `CAMERA_SMOOTHING` | 0.5 | 0–0.95 |
| `HAND_OPEN_THRESHOLD` | 0.35 | 0.15–0.5 |
| `BLOOM` | true | checkbox |
| `SUNRAYS` | true | checkbox |
| `COLORFUL` | true | checkbox |
| `SHADING` | true | checkbox |

## Gotchas / 踩坑警告

- **Never use `display:none` on the camera `<video>` element** — MediaPipe can't read frames from hidden videos. Use `opacity:0` + 1x1px. / **摄像头 `<video>` 严禁 `display:none`** —— 必须使用 `opacity:0` + 1×1px。
- **MediaPipe `initialize()` is mandatory** — `send()` silently no-ops without it. / **`initialize()` 必须调用** —— 否则 `send()` 静默丢弃帧。
- **COOP/COEP headers are mandatory** — Always use `server.js`. / **COOP/COEP 头是必须的** —— 始终使用 `server.js`。
- **Virtual camera filtering** — NDI/OBS cameras must be skipped. / **虚拟摄像头必须过滤**。
- **Local MediaPipe files** — All assets vendored locally, no CDN dependency. / **本地 MediaPipe 文件** —— 无 CDN 依赖。
