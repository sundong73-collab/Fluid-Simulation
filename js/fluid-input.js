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

    // ── pointerPrototype constructor ────────────────────────────────────────

    FS.pointerPrototype = function () {
        this.id = -1;
        this.texcoordX = 0;
        this.texcoordY = 0;
        this.prevTexcoordX = 0;
        this.prevTexcoordY = 0;
        this.deltaX = 0;
        this.deltaY = 0;
        this.down = false;
        this.moved = false;
        this.color = [30, 0, 300];
    };

    // ── Initialize ──────────────────────────────────────────────────────────

    FS.pointers.push(new FS.pointerPrototype());

    // ── Input processing functions ──────────────────────────────────────────

    FS.updatePointerDownData = function (pointer, id, posX, posY) {
        pointer.id = id;
        pointer.down = true;
        pointer.moved = false;
        pointer.texcoordX = posX / FS.canvas.width;
        pointer.texcoordY = 1.0 - posY / FS.canvas.height;
        pointer.prevTexcoordX = pointer.texcoordX;
        pointer.prevTexcoordY = pointer.texcoordY;
        pointer.deltaX = 0;
        pointer.deltaY = 0;
        pointer.color = FS.generateColor();
    };

    FS.updatePointerMoveData = function (pointer, posX, posY) {
        pointer.prevTexcoordX = pointer.texcoordX;
        pointer.prevTexcoordY = pointer.texcoordY;
        pointer.texcoordX = posX / FS.canvas.width;
        pointer.texcoordY = 1.0 - posY / FS.canvas.height;
        pointer.deltaX = FS.correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
        pointer.deltaY = FS.correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
        pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
    };

    FS.updatePointerUpData = function (pointer) {
        pointer.down = false;
    };

    FS.HSVtoRGB = function (h, s, v) {
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
    };

    FS.generateColor = function () {
        let c = FS.HSVtoRGB(Math.random(), 1.0, 1.0);
        c.r *= 0.15;
        c.g *= 0.15;
        c.b *= 0.15;
        return c;
    };

    // ── Event listeners ─────────────────────────────────────────────────────

    // Mouse
    FS.canvas.addEventListener('mousedown', function (e) {
        let posX = FS.scaleByPixelRatio(e.offsetX);
        let posY = FS.scaleByPixelRatio(e.offsetY);
        let pointer = FS.pointers.find(function (p) { return p.id == -1; });
        if (pointer == null)
            pointer = new FS.pointerPrototype();
        FS.updatePointerDownData(pointer, -1, posX, posY);
        console.log('mousedown', posX, posY, pointer.texcoordX, pointer.texcoordY);
    });

    FS.canvas.addEventListener('mousemove', function (e) {
        let pointer = FS.pointers.find(function (p) { return p.id == -1; });
        if (!pointer || !pointer.down) return;
        let posX = FS.scaleByPixelRatio(e.offsetX);
        let posY = FS.scaleByPixelRatio(e.offsetY);
        FS.updatePointerMoveData(pointer, posX, posY);
        if (pointer.moved) console.log('mousemove moved', pointer.deltaX, pointer.deltaY);
    });

    window.addEventListener('mouseup', function () {
        FS.updatePointerUpData(FS.pointers.find(function (p) { return p.id == -1; }));
    });

    // Touch
    FS.canvas.addEventListener('touchstart', function (e) {
        e.preventDefault();
        const touches = e.targetTouches;
        for (let i = 0; i < touches.length; i++) {
            let posX = FS.scaleByPixelRatio(touches[i].pageX);
            let posY = FS.scaleByPixelRatio(touches[i].pageY);
            let pointer = FS.pointers.find(function (p) { return p.id === touches[i].identifier; });
            if (!pointer) {
                pointer = new FS.pointerPrototype();
                FS.pointers.push(pointer);
            }
            FS.updatePointerDownData(pointer, touches[i].identifier, posX, posY);
        }
    });

    FS.canvas.addEventListener('touchmove', function (e) {
        e.preventDefault();
        const touches = e.targetTouches;
        for (let i = 0; i < touches.length; i++) {
            let pointer = FS.pointers.find(function (p) { return p.id === touches[i].identifier; });
            if (!pointer || !pointer.down) continue;
            let posX = FS.scaleByPixelRatio(touches[i].pageX);
            let posY = FS.scaleByPixelRatio(touches[i].pageY);
            FS.updatePointerMoveData(pointer, posX, posY);
        }
    }, false);

    window.addEventListener('touchend', function (e) {
        const touches = e.changedTouches;
        for (let i = 0; i < touches.length; i++)
        {
            let pointer = FS.pointers.find(function (p) { return p.id == touches[i].identifier; });
            if (pointer == null) continue;
            FS.updatePointerUpData(pointer);
        }
    });

    // Keyboard
    window.addEventListener('keydown', function (e) {
        if (e.code === 'KeyP')
            FS.config.PAUSED = !FS.config.PAUSED;
        if (e.key === ' ')
            FS.splatStack.push(parseInt(Math.random() * 20) + 5);
        if (e.code === 'KeyD' && e.ctrlKey) {
            e.preventDefault();
            const dbg = document.getElementById('debug-panel');
            if (dbg) dbg.style.display = dbg.style.display === 'none' ? 'block' : 'none';
        }
    });

    // ── Core input functions ────────────────────────────────────────────────

    FS.applyInputs = function () {
        if (FS.splatStack.length > 0)
            FS.multipleSplats(FS.splatStack.pop());

        // Interpolate hand pointers between MediaPipe callbacks for smooth trails
        if (FS.handPointers) {
            for (const hp of FS.handPointers) {
                if (hp.down && !hp.moved) {
                    hp.prevTexcoordX = hp.texcoordX;
                    hp.prevTexcoordY = hp.texcoordY;
                    hp.texcoordX += hp.deltaX * 0.33;
                    hp.texcoordY += hp.deltaY * 0.33;
                    hp.texcoordX = Math.max(0, Math.min(1, hp.texcoordX));
                    hp.texcoordY = Math.max(0, Math.min(1, hp.texcoordY));
                    hp.moved = true;
                }
            }
        }

        var splatCount = 0;
        FS.pointers.forEach(function (p) {
            if (p.moved) {
                p.moved = false;
                FS.splatPointer(p);
                splatCount++;
            }
        });
        if (splatCount > 0 && FS.diagnosticCounter % 10 === 0) console.log('splatCount:', splatCount);
    };

    FS.updateColors = function (dt) {
        if (!FS.config.COLORFUL) return;

        FS.colorUpdateTimer += dt * FS.config.COLOR_UPDATE_SPEED;
        if (FS.colorUpdateTimer >= 1) {
            FS.colorUpdateTimer = FS.wrap(FS.colorUpdateTimer, 0, 1);
            FS.pointers.forEach(function (p) {
                p.color = FS.generateColor();
            });
        }
    };

})(window.FluidSim = window.FluidSim || {});
