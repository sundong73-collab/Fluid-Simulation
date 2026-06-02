# WebGL Fluid Simulation / WebGL 流体模拟

[Play here / 在线演示](https://paveldogreat.github.io/WebGL-Fluid-Simulation/)

<img src="/screenshot.jpg?raw=true" width="880">

基于 WebGL 的实时 2D 流体模拟，使用 GPU 加速的 Jos Stam "Stable Fluids" 算法。支持鼠标、触摸和摄像头手势识别三种交互方式。

A real-time 2D fluid simulation using WebGL, powered by Jos Stam's "Stable Fluids" algorithm on GPU. Supports mouse, touch, and webcam hand gesture input.

## 运行方式 / Running

```sh
node server.js
# 打开 http://localhost:8083/index.html
```

必须使用 Node.js 服务器启动 —— MediaPipe 的 WASM 需要 SharedArrayBuffer，浏览器仅在收到 COOP/COEP 头时启用此特性。

Must use the Node.js server — MediaPipe WASM requires SharedArrayBuffer (COOP/COEP headers).

## 手势交互 / Hand Gesture

- 手掌张开 → 绘制流体 / Open hand → draw fluid
- 握拳 → 停止绘制 / Closed fist → stop drawing
- 食指指尖控制流体位置 / Index fingertip controls fluid position
- 支持双手同时操作 / Both hands supported simultaneously

## Features / 功能特性

- dat.GUI 参数调节面板 / dat.GUI control panel
- Bloom 泛光 + Sunrays 太阳光线后处理 / Bloom + Sunrays post-processing
- 截图保存 / Screenshot capture
- 多彩颜色模式 / Colorful color mode
- 键盘快捷键：P 暂停，空格键随机泼溅 / Keyboard: P pause, Space random splats

## References / 参考资料

https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu

https://github.com/mharrys/fluids-2d

https://github.com/haxiomic/GPU-Fluid-Experiments

## License / 许可证

The code is available under the [MIT license](LICENSE)
