(function (FS) {
    'use strict';

    // ===== Canvas initialization =====
    (function initCanvas() {
        var width = FS.scaleByPixelRatio(FS.canvas.clientWidth);
        var height = FS.scaleByPixelRatio(FS.canvas.clientHeight);
        FS.canvas.width = width;
        FS.canvas.height = height;
    })();

    // ===== Auto-start camera check (no getUserMedia yet) =====
    (async function autoStart() {
        await FS.checkCameraAvailability();
        await FS.initHandTracking();
    })();

    // ===== GUI setup =====
    FS.startGUI();

    // ===== Initialize framebuffers and start =====
    FS.updateKeywords();
    FS.initFramebuffers();
    FS.multipleSplats(parseInt(Math.random() * 20) + 5);

    // ===== Main update loop =====
    var lastUpdateTime = Date.now();
    FS.lastUpdateTime = lastUpdateTime;

    function calcDeltaTime() {
        var now = Date.now();
        var dt = (now - lastUpdateTime) / 1000;
        dt = Math.min(dt, 0.016666);
        lastUpdateTime = now;
        return dt;
    }

    function resizeCanvas() {
        var width = FS.scaleByPixelRatio(FS.canvas.clientWidth);
        var height = FS.scaleByPixelRatio(FS.canvas.clientHeight);
        if (FS.canvas.width != width || FS.canvas.height != height) {
            FS.canvas.width = width;
            FS.canvas.height = height;
            return true;
        }
        return false;
    }

    function update() {
        var dt = calcDeltaTime();
        if (resizeCanvas()) {
            if (FS.resizeDebounceTimer) clearTimeout(FS.resizeDebounceTimer);
            FS.resizeDebounceTimer = setTimeout(function () {
                FS.initFramebuffers();
                FS.resizeDebounceTimer = null;
            }, FS.RESIZE_DEBOUNCE_MS);
        }
        FS.updateColors(dt);
        FS.mediaPipeFrameCounter++;
        if (FS.config.CAMERA_ENABLED && FS.cameraEnabled && FS.handLandmarker && FS.sendErrorCount < FS.MAX_SEND_ERRORS) {
            if (FS.mediaPipeFrameCounter % FS.config.MEDIA_PIPE_FRAME_SKIP === 0) {
                if (FS.videoInput.readyState >= FS.videoInput.HAVE_CURRENT_DATA && FS.videoInput.videoWidth > 0) {
                    try {
                        FS.handLandmarker.send({ image: FS.videoInput });
                        FS.sendCounter++;
                    } catch (e) {
                        FS.sendErrorCount++;
                        if (FS.sendErrorCount >= FS.MAX_SEND_ERRORS) {
                            console.error('MediaPipe send errors exceeded limit, stopping');
                        }
                    }
                }
            }
        }
        FS.applyInputs();
        if (!FS.config.PAUSED)
            FS.step(dt);
        FS.render(null);
        FS.diagnosticCounter++;
        if (FS.diagnosticCounter % 30 === 0) {
            var dbg = document.getElementById('debug-panel');
            if (dbg) {
                var p0 = FS.pointers.length > 0 ? FS.pointers[0] : null;
                dbg.innerHTML =
                    'v2 | CAMERA: ' + (FS.config.CAMERA_ENABLED ? 'ON' : 'OFF') + '<br>' +
                    'enabled: ' + FS.cameraEnabled + ' | ready: ' + FS.handsReady + '<br>' +
                    'send: ' + FS.sendCounter + ' | hands: ' + FS.lastHandCount + '<br>' +
                    'errs: ' + FS.sendErrorCount + ' | video: ' + FS.videoInput.videoWidth + 'x' + FS.videoInput.videoHeight + '<br>' +
                    'paused: ' + FS.config.PAUSED + ' | ptr moved: ' + (p0 ? p0.moved : '?');
            }
        }
        requestAnimationFrame(update);
    }

    update();

    // ===== Window resize handler for camera dot =====
    window.addEventListener('resize', function () {
        if (FS.positionCameraDot) FS.positionCameraDot();
    });

    // ===== Sidebar toggle =====
    (function () {
        var sidebar = document.getElementById('sidebar');
        var toggle = document.getElementById('sidebar-toggle');
        var isOpen = true;
        toggle.addEventListener('click', function () {
            isOpen = !isOpen;
            if (isOpen) {
                sidebar.classList.remove('collapsed');
                toggle.innerHTML = '▲';
                toggle.title = '收起';
            } else {
                sidebar.classList.add('collapsed');
                toggle.innerHTML = '▼';
                toggle.title = '展开';
            }
        });
    })();

})(window.FluidSim = window.FluidSim || {});
