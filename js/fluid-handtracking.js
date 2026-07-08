/*
MIT License

Copyright (c) 2017 Pavel Dobryakov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

'use strict';

(function(FS) {

// --- Hand tracking state ---
FS.cameraEnabled = false;
FS.handLandmarker = null;
FS.cameraStream = null;
FS.videoInput = document.getElementById('webcam');
FS.videoPreview = document.getElementById('webcam-preview-video');
FS.previewContainer = document.getElementById('webcam-preview');
FS.statusIndicator = document.getElementById('camera-status');
FS.cameraDot = document.getElementById('camera-dot');

FS.handPointers = [];
FS.lastHandPositions = {};
FS.smoothedPositions = {};
FS.handDownState = {};
FS.handsReady = false;
FS.sendErrorCount = 0;
FS.MAX_SEND_ERRORS = 10;
FS.sendCounter = 0;
FS.lastHandCount = 0;
FS.resultKeys = '';
FS.diagnosticCounter = 0;
FS.mediaPipeFrameCounter = 0;
FS.resizeDebounceTimer = null;
FS.RESIZE_DEBOUNCE_MS = 300;

// --- Preview panel: drag & collapse ---
(function () {
    var preview = FS.previewContainer;
    var header = document.getElementById('preview-header');
    var body = document.getElementById('preview-body');
    var btn = document.getElementById('preview-collapse-btn');
    var dragging = false, dragStartX, dragStartY, startLeft, startTop;
    var collapsed = false;

    if (!preview || !header) return;

    header.addEventListener('mousedown', function (e) {
        if (e.target === btn) return; // don't drag when clicking collapse button
        dragging = true;
        var rect = preview.getBoundingClientRect();
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var newLeft = startLeft + e.clientX - dragStartX;
        var newTop = startTop + e.clientY - dragStartY;
        var pw = preview.offsetWidth;
        var ph = preview.offsetHeight;
        newLeft = Math.max(0, Math.min(window.innerWidth - pw, newLeft));
        newTop = Math.max(0, Math.min(window.innerHeight - 20, newTop));
        preview.style.right = 'auto';
        preview.style.bottom = 'auto';
        preview.style.left = newLeft + 'px';
        preview.style.top = newTop + 'px';
    });

    window.addEventListener('mouseup', function () {
        dragging = false;
    });

    btn.addEventListener('click', function (e) {
        collapsed = !collapsed;
        body.style.display = collapsed ? 'none' : 'block';
        btn.textContent = collapsed ? '+' : '−';
        btn.title = collapsed ? '展开预览' : '折叠预览';
        e.stopPropagation();
    });
})();

// --- Private helpers ---

function generateColor () {
    let c = HSVtoRGB(Math.random(), 1.0, 1.0);
    c.r *= 0.15;
    c.g *= 0.15;
    c.b *= 0.15;
    return c;
}

function HSVtoRGB (h, s, v) {
    let r, g, b, i, f, p, q, t;
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);

    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }

    return {
        r,
        g,
        b
    };
}

// --- Public functions ---

FS.startCamera = async function() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        let realCamera = null;
        for (const d of videoDevices) {
            const label = (d.label || '').toLowerCase();
            if (!label.includes('ndi') && !label.includes('obs') && !label.includes('virtual')) {
                realCamera = d;
                break;
            }
        }
        let stream;
        if (realCamera) {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: { exact: realCamera.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } },
                    audio: false
                });
            } catch (e) {
                // enumerateDevices returns placeholder IDs before permission is granted;
                // fall back to basic constraints which trigger the permission prompt properly
                console.warn('Camera exact deviceId failed, retrying with basic constraints:', e.name);
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
                    audio: false
                });
            }
        } else {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
                audio: false
            });
        }
        FS.cameraStream = stream;
        FS.videoInput.srcObject = stream;
        FS.videoPreview.srcObject = stream;
        await FS.videoInput.play();
        await FS.videoPreview.play();
        FS.videoInput.onended = () => {
            FS.config.CAMERA_ENABLED = false;
            FS.stopCamera();
        };
        FS.cameraEnabled = true;
        FS.showCameraStatus('active');
        return true;
    } catch (err) {
        console.warn('Camera error:', err.name, err.message, err);
        if (FS.statusIndicator) {
            FS.statusIndicator.style.display = 'block';
            FS.statusIndicator.textContent = 'Camera: ' + (err.message || err.name || 'unknown error');
            FS.statusIndicator.className = 'error';
            FS.statusIndicator.style.opacity = '1';
            FS.positionCameraDot();
        }
        FS.showCameraStatus('error');
        FS.config.CAMERA_ENABLED = false;
        return false;
    }
};

FS.stopCamera = function() {
    if (FS.cameraStream) {
        const tracks = FS.cameraStream.getTracks();
        FS.cameraStream = null;
        tracks.forEach(track => track.stop());
    }
    FS.videoInput.srcObject = null;
    FS.videoPreview.srcObject = null;
    FS.cameraEnabled = false;
    for (const hp of FS.handPointers) {
        const idx = FS.pointers.indexOf(hp);
        if (idx !== -1) FS.pointers.splice(idx, 1);
    }
    FS.handPointers.length = 0;
    FS.lastHandPositions = {};
    FS.smoothedPositions = {};
    FS.handDownState = {};
    FS.handsReady = false;
    FS.sendErrorCount = 0;
    FS.sendCounter = 0;
    FS.lastHandCount = 0;
    FS.hideCameraStatus();
};

FS.initHandTracking = async function() {
    if (FS.handLandmarker) return FS.handLandmarker;
    FS.handsReady = false;
    FS.sendErrorCount = 0;
    FS.handLandmarker = new Hands({
        locateFile: (file) => file
    });
    FS.handLandmarker.setOptions({
        maxNumHands: FS.config.MAX_HANDS,
        modelComplexity: 1,
        minDetectionConfidence: 0.1,
        minTrackingConfidence: 0.1,
        selfieMode: true
    });
    FS.handLandmarker.onResults((results) => {
        if (!FS.handsReady) {
            FS.handsReady = true;
            FS.resultKeys = Object.keys(results).join(',');
        }
        const count = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
        FS.lastHandCount = count;
        FS.onHandResults(results);
    });
    if (typeof FS.handLandmarker.initialize === 'function') {
        let retries = 0;
        const maxRetries = 3;
        function tryInit() {
            FS.handLandmarker.initialize().then(() => {
                console.log('MediaPipe Hands model loaded');
            }).catch((e) => {
                retries++;
                console.error('MediaPipe Hands initialize() attempt ' + retries + ' failed:', e);
                if (retries < maxRetries) {
                    setTimeout(tryInit, 1000 * retries);
                } else {
                    console.error('MediaPipe Hands initialization failed after ' + maxRetries + ' attempts');
                    FS.showCameraStatus('error');
                }
            });
        }
        tryInit();
    }
    return FS.handLandmarker;
};

FS.detectOpenHand = function(landmarks) {
    const wrist = landmarks[0];
    const fingerTips = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
    const middleMcp = landmarks[9];
    const refDist = Math.sqrt(
        Math.pow(middleMcp.x - wrist.x, 2) + Math.pow(middleMcp.y - wrist.y, 2)
    );
    if (refDist < 0.01) return false;
    let avgDist = 0;
    for (const tip of fingerTips) {
        avgDist += Math.sqrt(
            Math.pow(tip.x - wrist.x, 2) + Math.pow(tip.y - wrist.y, 2)
        );
    }
    avgDist = (avgDist / fingerTips.length) / refDist;
    return avgDist > FS.config.HAND_OPEN_THRESHOLD;
};

FS.clusterHandsByPerson = function(worldLandmarks, handedness) {
    const n = worldLandmarks.length;
    const clusters = [];
    for (let i = 0; i < n; i++) {
        const wrist = worldLandmarks[i][0];
        clusters.push({
            handIndices: [i],
            wristX: wrist.x,
            wristY: wrist.y,
            wristZ: wrist.z,
            avgDepth: wrist.z,
            labels: handedness ? [handedness[i].label] : []
        });
    }
    if (n <= 1) return clusters;
    let merged = true;
    while (merged) {
        merged = false;
        for (let i = 0; i < clusters.length && !merged; i++) {
            for (let j = i + 1; j < clusters.length && !merged; j++) {
                if (FS.canBeSamePerson(clusters[i], clusters[j])) {
                    clusters[i].handIndices.push(...clusters[j].handIndices);
                    clusters[i].labels.push(...clusters[j].labels);
                    const allZ = clusters[i].handIndices.map(idx => worldLandmarks[idx][0].z);
                    clusters[i].avgDepth = allZ.reduce((a, b) => a + b, 0) / allZ.length;
                    clusters[i].wristX = (clusters[i].wristX + clusters[j].wristX) / 2;
                    clusters[i].wristY = (clusters[i].wristY + clusters[j].wristY) / 2;
                    clusters[i].wristZ = Math.min(clusters[i].wristZ, clusters[j].wristZ);
                    clusters.splice(j, 1);
                    merged = true;
                }
            }
        }
    }
    return clusters;
};

FS.canBeSamePerson = function(c1, c2) {
    const depthThresh = FS.config.PERSON_DEPTH_THRESHOLD;
    const xyThresh = FS.config.PERSON_XY_THRESHOLD;
    if (c1.labels.length > 0 && c2.labels.length > 0) {
        const c1OnlyLeft = c1.labels.every(l => l === 'Left');
        const c1OnlyRight = c1.labels.every(l => l === 'Right');
        const c2OnlyLeft = c2.labels.every(l => l === 'Left');
        const c2OnlyRight = c2.labels.every(l => l === 'Right');
        if ((c1OnlyLeft && c2OnlyLeft) || (c1OnlyRight && c2OnlyRight)) {
            return false;
        }
    }
    if (Math.abs(c1.avgDepth - c2.avgDepth) > depthThresh) return false;
    const dx = c1.wristX - c2.wristX;
    const dy = c1.wristY - c2.wristY;
    if (Math.sqrt(dx * dx + dy * dy) > xyThresh) return false;
    return true;
};

FS.selectBestHand = function(handIndices, landmarks) {
    if (handIndices.length === 0) return null;
    if (handIndices.length === 1) return handIndices[0];
    for (const idx of handIndices) {
        if (FS.detectOpenHand(landmarks[idx])) return idx;
    }
    return handIndices[0];
};

FS.onHandResults = function(results) {
    if (!FS.cameraEnabled || !results.multiHandLandmarks) return;

    const allLandmarks = results.multiHandLandmarks;
    const allWorld = results.multiHandWorldLandmarks;
    const allHandedness = results.multiHandedness;
    const totalDetected = allLandmarks.length;

    // Determine active hand indices via person-aware clustering
    let activeIndices = [];
    let personCount = 0;
    if (totalDetected <= 2) {
        activeIndices = Array.from({ length: totalDetected }, (_, i) => i);
        personCount = totalDetected > 0 ? 1 : 0;
    } else if (allWorld) {
        const clusters = FS.clusterHandsByPerson(allWorld, allHandedness);
        clusters.sort((a, b) => a.avgDepth - b.avgDepth);
        personCount = clusters.length;
        if (clusters.length === 1) {
            activeIndices = clusters[0].handIndices.slice(0, 2);
        } else {
            for (let i = 0; i < 2 && i < clusters.length; i++) {
                const best = FS.selectBestHand(clusters[i].handIndices, allLandmarks);
                if (best !== null) activeIndices.push(best);
            }
        }
    } else {
        activeIndices = [0, 1];
        personCount = 1;
    }

    // Ensure handPointers array matches active hand count
    const activeCount = activeIndices.length;
    while (FS.handPointers.length < activeCount) {
        const hp = new FS.pointerPrototype();
        hp.id = -10 - FS.handPointers.length;
        FS.pointers.push(hp);
        FS.handPointers.push(hp);
    }

    // Process each active hand
    for (let i = 0; i < activeCount; i++) {
        const handIdx = activeIndices[i];
        const landmarks = allLandmarks[handIdx];
        const hp = FS.handPointers[i];
        let camX = landmarks[8].x;
        let camY = landmarks[8].y;
        const key = i;
        if (!FS.smoothedPositions[key]) {
            FS.smoothedPositions[key] = { x: camX, y: camY };
        }
        const s = FS.config.CAMERA_SMOOTHING;
        FS.smoothedPositions[key].x = FS.smoothedPositions[key].x * (1 - s) + camX * s;
        FS.smoothedPositions[key].y = FS.smoothedPositions[key].y * (1 - s) + camY * s;
        const texcoordX = FS.smoothedPositions[key].x;
        const texcoordY = 1.0 - FS.smoothedPositions[key].y;
        if (!FS.lastHandPositions[key]) {
            FS.lastHandPositions[key] = { x: texcoordX, y: texcoordY };
        }
        let deltaX = texcoordX - FS.lastHandPositions[key].x;
        let deltaY = texcoordY - FS.lastHandPositions[key].y;
        deltaX = FS.correctDeltaX(deltaX) * FS.config.CAMERA_SENSITIVITY;
        deltaY = FS.correctDeltaY(deltaY) * FS.config.CAMERA_SENSITIVITY;
        FS.lastHandPositions[key].x = texcoordX;
        FS.lastHandPositions[key].y = texcoordY;
        const wasDown = FS.handDownState[key] === true;
        hp.texcoordX = texcoordX;
        hp.texcoordY = texcoordY;
        hp.prevTexcoordX = FS.lastHandPositions[key].x - deltaX;
        hp.prevTexcoordY = FS.lastHandPositions[key].y - deltaY;
        hp.deltaX = deltaX;
        hp.deltaY = deltaY;
        const isOpen = FS.detectOpenHand(landmarks);
        if (isOpen && !wasDown) {
            hp.down = true;
            hp.moved = false;
            hp.color = generateColor();
        } else if (isOpen && wasDown) {
            hp.down = true;
            hp.moved = Math.abs(deltaX) > 0.0001 || Math.abs(deltaY) > 0.0001;
        } else if (!isOpen) {
            hp.down = false;
            hp.moved = false;
        }
        FS.handDownState[key] = isOpen;
    }

    // Clear unused hand pointer slots
    for (let i = activeCount; i < FS.handPointers.length; i++) {
        FS.handPointers[i].down = false;
        FS.handPointers[i].moved = false;
    }

    // Any closed fist immediately pauses the simulation
    if (activeCount > 0) {
        const anyHandClosed = FS.handPointers.slice(0, activeCount).some(hp => !hp.down);
        FS.config.PAUSED = anyHandClosed;
    }
    if (FS.statusIndicator && activeCount > 0) {
        FS.statusIndicator.style.display = 'block';
        FS.statusIndicator.className = 'active';
        FS.statusIndicator.textContent = 'Hands: ' + activeCount + (totalDetected > 2 ? ' (detected ' + totalDetected + ', ' + personCount + ' ppl)' : '');
        FS.statusIndicator.style.opacity = '1';
        FS.positionCameraDot();
    }
};

FS.showCameraStatus = function(state) {
    if (FS.statusIndicator) {
        FS.statusIndicator.style.display = 'block';
        FS.statusIndicator.className = '';
        if (state === 'loading') {
            FS.statusIndicator.className = 'loading';
            FS.statusIndicator.textContent = 'Camera initializing...';
        } else if (state === 'active') {
            FS.statusIndicator.className = 'active';
            FS.statusIndicator.textContent = 'Camera Active';
        } else if (state === 'available') {
            FS.statusIndicator.className = 'available';
            FS.statusIndicator.textContent = 'Camera detected';
        } else if (state === 'error') {
            FS.statusIndicator.className = 'error';
            FS.statusIndicator.textContent = 'Camera unavailable';
        }
        if (state === 'active') {
            setTimeout(() => {
                if (FS.statusIndicator.className === 'active') {
                    FS.statusIndicator.style.opacity = '0';
                    setTimeout(() => {
                        FS.statusIndicator.style.display = 'none';
                        FS.statusIndicator.style.opacity = '1';
                    }, 300);
                }
            }, 2000);
        }
        if (state === 'available' || state === 'error') {
            setTimeout(() => {
                FS.statusIndicator.style.opacity = '0';
                setTimeout(() => {
                    FS.statusIndicator.style.display = 'none';
                    FS.statusIndicator.style.opacity = '1';
                }, 300);
            }, 3000);
        }
    }
    if (FS.cameraDot) {
        FS.cameraDot.className = '';
        if (state === 'loading') FS.cameraDot.className = 'checking';
        else if (state === 'active') FS.cameraDot.className = 'available';
        else if (state === 'available') FS.cameraDot.className = 'available';
        else if (state === 'error') FS.cameraDot.className = 'unavailable';
        FS.cameraDot.title = state === 'active' || state === 'available' ? 'Camera available' : state === 'error' ? 'Camera unavailable' : 'Checking camera...';
    }
    FS.positionCameraDot();
};

FS.positionCameraDot = function() {
    if (!FS.cameraDot) return;
    requestAnimationFrame(() => {
        if (!FS.statusIndicator) return;
        const rect = FS.statusIndicator.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            // status hidden — fallback to top-right corner
            FS.cameraDot.style.top = '14px';
            FS.cameraDot.style.right = '14px';
            FS.cameraDot.style.left = 'auto';
            return;
        }
        // 10px to the right of camera-status, vertically centered
        FS.cameraDot.style.top = (rect.top + rect.height / 2 - 6) + 'px';
        FS.cameraDot.style.right = 'auto';
        FS.cameraDot.style.left = (rect.right + 10) + 'px';
    });
};

FS.hideCameraStatus = function() {
    if (FS.statusIndicator) FS.statusIndicator.style.display = 'none';
    if (FS.cameraDot) FS.cameraDot.className = 'inactive';
    FS.positionCameraDot();
};

FS.checkCameraAvailability = async function() {
    if (FS.cameraDot) FS.cameraDot.className = 'checking';
    FS.showCameraStatus('loading');
    try {
        const result = await navigator.permissions.query({ name: 'camera' });
        if (result.state === 'granted') {
            FS.showCameraStatus('available');
        } else if (result.state === 'denied') {
            FS.showCameraStatus('error');
        } else {
            FS.showCameraStatus('loading');
        }
        result.addEventListener('change', () => {
            if (result.state === 'granted') FS.showCameraStatus('available');
            else if (result.state === 'denied') FS.showCameraStatus('error');
        });
    } catch (e) {
        FS.showCameraStatus('loading');
    }
};

FS.autoStart = async function() {
    await FS.checkCameraAvailability();
    await FS.initHandTracking();
    // Don't auto-start camera — getUserMedia requires a user gesture on HTTPS origins.
    // User enables camera via the dat.GUI "enable camera" checkbox instead.
};

})(window.FluidSim = window.FluidSim || {});
