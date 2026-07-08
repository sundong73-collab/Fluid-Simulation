(function (FS) {
    'use strict';

    FS.startGUI = function () {
        var gui = new dat.GUI({ width: 300 });
        gui.add(FS.config, 'DYE_RESOLUTION', { 'high': 1024, 'medium': 512, 'low': 256, 'very low': 128 }).name('quality').onFinishChange(FS.initFramebuffers);
        gui.add(FS.config, 'SIM_RESOLUTION', { '32': 32, '64': 64, '128': 128, '256': 256 }).name('sim resolution').onFinishChange(FS.initFramebuffers);
        gui.add(FS.config, 'DENSITY_DISSIPATION', 0, 4.0).name('density diffusion');
        gui.add(FS.config, 'VELOCITY_DISSIPATION', 0, 4.0).name('velocity diffusion');
        gui.add(FS.config, 'PRESSURE', 0.0, 1.0).name('pressure');
        gui.add(FS.config, 'CURL', 0, 50).name('vorticity').step(1);
        gui.add(FS.config, 'SPLAT_RADIUS', 0.01, 1.0).name('splat radius');
        gui.add(FS.config, 'SPLAT_FORCE', 1000, 20000).name('splat force').step(100);
        gui.add(FS.config, 'SHADING').name('shading').onFinishChange(FS.updateKeywords);
        gui.add(FS.config, 'COLORFUL').name('colorful');
        gui.add(FS.config, 'PAUSED').name('paused').listen();

        gui.add({ fun: function () {
            FS.splatStack.push(parseInt(Math.random() * 20) + 5);
        } }, 'fun').name('Random splats');

        var bloomFolder = gui.addFolder('Bloom');
        bloomFolder.add(FS.config, 'BLOOM').name('enabled').onFinishChange(FS.updateKeywords);
        bloomFolder.add(FS.config, 'BLOOM_INTENSITY', 0.1, 2.0).name('intensity');
        bloomFolder.add(FS.config, 'BLOOM_THRESHOLD', 0.0, 1.0).name('threshold');

        var sunraysFolder = gui.addFolder('Sunrays');
        sunraysFolder.add(FS.config, 'SUNRAYS').name('enabled').onFinishChange(FS.updateKeywords);
        sunraysFolder.add(FS.config, 'SUNRAYS_WEIGHT', 0.3, 1.0).name('weight');

        var captureFolder = gui.addFolder('Capture');
        captureFolder.addColor(FS.config, 'BACK_COLOR').name('background color');
        captureFolder.add(FS.config, 'TRANSPARENT').name('transparent');
        captureFolder.add({ fun: FS.captureScreenshot }, 'fun').name('take screenshot');

        var cameraFolder = gui.addFolder('Camera (Hand Tracking)');
        var cameraEnableCtrl = cameraFolder.add(FS.config, 'CAMERA_ENABLED').name('enable camera');
        cameraEnableCtrl.onFinishChange(async function (value) {
            if (value) {
                FS.showCameraStatus('loading');
                await FS.initHandTracking();
                var success = await FS.startCamera();
                if (!success) {
                    FS.config.CAMERA_ENABLED = false;
                    cameraEnableCtrl.updateDisplay();
                }
            } else {
                FS.stopCamera();
            }
        });
        cameraFolder.add(FS.config, 'CAMERA_PREVIEW').name('show preview').onFinishChange(function (value) {
            FS.previewContainer.style.display = value ? 'block' : 'none';
        });
        cameraFolder.add(FS.config, 'CAMERA_SENSITIVITY', 0.1, 5.0).name('sensitivity');
        cameraFolder.add(FS.config, 'CAMERA_SMOOTHING', 0.0, 0.95).name('smoothing');
        cameraFolder.add(FS.config, 'MEDIA_PIPE_FRAME_SKIP', 1, 5).name('detection rate').step(1);
        cameraFolder.add(FS.config, 'HAND_OPEN_THRESHOLD', 0.15, 0.95).name('open hand threshold');
        cameraFolder.add(FS.config, 'MAX_HANDS', 2, 10).name('max hands detect').step(1);
        cameraFolder.add(FS.config, 'PERSON_DEPTH_THRESHOLD', 0.2, 1.0).name('person depth thr');
        cameraFolder.add(FS.config, 'PERSON_XY_THRESHOLD', 0.4, 1.5).name('person xy thr');

        if (FS.isMobile())
            gui.close();
    };

})(window.FluidSim = window.FluidSim || {});
