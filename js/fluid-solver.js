(function (FS) {
    'use strict';

    // ===== Private helpers =====

    function HSVtoRGB (h, s, v) {
        let r, g, b, i, f, p, q, t;
        i = Math.floor(h * 6);
        f = h * 6 - i;
        p = v * (1 - s);
        q = v * (1 - f * s);
        t = v * (1 - (1 - f) * s);

        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }

        return { r: r || 0, g: g || 0, b: b || 0 };
    }

    function generateColor () {
        let c = HSVtoRGB(Math.random(), 1.0, 1.0);
        c.r *= 0.15;
        c.g *= 0.15;
        c.b *= 0.15;
        return c;
    }

    // Expose generateColor for use by other modules (pointer colors, etc.)
    FS.generateColor = generateColor;

    // ===== Solver shader source code =====

    FS.splatShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, `
        precision highp float;
        precision highp sampler2D;

        varying vec2 vUv;
        uniform sampler2D uTarget;
        uniform float aspectRatio;
        uniform vec3 color;
        uniform vec2 point;
        uniform float radius;

        void main () {
            vec2 p = vUv - point.xy;
            p.x *= aspectRatio;
            vec3 splat = exp(-dot(p, p) / radius) * color;
            vec3 base = texture2D(uTarget, vUv).xyz;
            gl_FragColor = vec4(base + splat, 1.0);
        }
    `);

    FS.advectionShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, `
        precision highp float;
        precision highp sampler2D;

        varying vec2 vUv;
        uniform sampler2D uVelocity;
        uniform sampler2D uSource;
        uniform vec2 texelSize;
        uniform vec2 dyeTexelSize;
        uniform float dt;
        uniform float dissipation;

        vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
            vec2 st = uv / tsize - 0.5;

            vec2 iuv = floor(st);
            vec2 fuv = fract(st);

            vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
            vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
            vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
            vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

            return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
        }

        void main () {
        #ifdef MANUAL_FILTERING
            vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
            vec4 result = bilerp(uSource, coord, dyeTexelSize);
        #else
            vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
            vec4 result = texture2D(uSource, coord);
        #endif
            float decay = 1.0 + dissipation * dt;
            gl_FragColor = result / decay;
        }`,
        FS.ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']
    );

    FS.divergenceShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;

        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uVelocity;

        void main () {
            float L = texture2D(uVelocity, vL).x;
            float R = texture2D(uVelocity, vR).x;
            float T = texture2D(uVelocity, vT).y;
            float B = texture2D(uVelocity, vB).y;

            vec2 C = texture2D(uVelocity, vUv).xy;
            if (vL.x < 0.0) { L = -C.x; }
            if (vR.x > 1.0) { R = -C.x; }
            if (vT.y > 1.0) { T = -C.y; }
            if (vB.y < 0.0) { B = -C.y; }

            float div = 0.5 * (R - L + T - B);
            gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
        }
    `);

    FS.curlShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;

        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uVelocity;

        void main () {
            float L = texture2D(uVelocity, vL).y;
            float R = texture2D(uVelocity, vR).y;
            float T = texture2D(uVelocity, vT).x;
            float B = texture2D(uVelocity, vB).x;
            float vorticity = R - L - T + B;
            gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
        }
    `);

    FS.vorticityShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, `
        precision highp float;
        precision highp sampler2D;

        varying vec2 vUv;
        varying vec2 vL;
        varying vec2 vR;
        varying vec2 vT;
        varying vec2 vB;
        uniform sampler2D uVelocity;
        uniform sampler2D uCurl;
        uniform float curl;
        uniform float dt;

        void main () {
            float L = texture2D(uCurl, vL).x;
            float R = texture2D(uCurl, vR).x;
            float T = texture2D(uCurl, vT).x;
            float B = texture2D(uCurl, vB).x;
            float C = texture2D(uCurl, vUv).x;

            vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
            force /= length(force) + 0.0001;
            force *= curl * C;
            force.y *= -1.0;

            vec2 velocity = texture2D(uVelocity, vUv).xy;
            velocity += force * dt;
            velocity = min(max(velocity, -1000.0), 1000.0);
            gl_FragColor = vec4(velocity, 0.0, 1.0);
        }
    `);

    FS.pressureShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;

        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uPressure;
        uniform sampler2D uDivergence;

        void main () {
            float L = texture2D(uPressure, vL).x;
            float R = texture2D(uPressure, vR).x;
            float T = texture2D(uPressure, vT).x;
            float B = texture2D(uPressure, vB).x;
            float C = texture2D(uPressure, vUv).x;
            float divergence = texture2D(uDivergence, vUv).x;
            float pressure = (L + R + B + T - divergence) * 0.25;
            gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
        }
    `);

    FS.gradientSubtractShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;

        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uPressure;
        uniform sampler2D uVelocity;

        void main () {
            float L = texture2D(uPressure, vL).x;
            float R = texture2D(uPressure, vR).x;
            float T = texture2D(uPressure, vT).x;
            float B = texture2D(uPressure, vB).x;
            vec2 velocity = texture2D(uVelocity, vUv).xy;
            velocity.xy -= vec2(R - L, T - B);
            gl_FragColor = vec4(velocity, 0.0, 1.0);
        }
    `);

    // ===== Solver Program instances =====

    FS.splatProgram           = new FS.Program(FS.baseVertexShader, FS.splatShader);
    FS.advectionProgram       = new FS.Program(FS.baseVertexShader, FS.advectionShader);
    FS.divergenceProgram      = new FS.Program(FS.baseVertexShader, FS.divergenceShader);
    FS.curlProgram            = new FS.Program(FS.baseVertexShader, FS.curlShader);
    FS.vorticityProgram       = new FS.Program(FS.baseVertexShader, FS.vorticityShader);
    FS.pressureProgram        = new FS.Program(FS.baseVertexShader, FS.pressureShader);
    FS.gradienSubtractProgram = new FS.Program(FS.baseVertexShader, FS.gradientSubtractShader);

    // ===== FBO variables =====

    FS.dye        = null;
    FS.velocity   = null;
    FS.divergence = null;
    FS.curl       = null;
    FS.pressure   = null;

    // ===== Solver functions =====

    FS.initFramebuffers = function () {
        let simRes = FS.getResolution(FS.config.SIM_RESOLUTION);
        let dyeRes = FS.getResolution(FS.config.DYE_RESOLUTION);

        const texType = FS.ext.halfFloatTexType;
        const rgba    = FS.ext.formatRGBA;
        const rg      = FS.ext.formatRG;
        const r       = FS.ext.formatR;
        const filtering = FS.ext.supportLinearFiltering ? FS.gl.LINEAR : FS.gl.NEAREST;

        FS.gl.disable(FS.gl.BLEND);

        if (FS.dye == null)
            FS.dye = FS.createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
        else
            FS.dye = FS.resizeDoubleFBO(FS.dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);

        if (FS.velocity == null)
            FS.velocity = FS.createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
        else
            FS.velocity = FS.resizeDoubleFBO(FS.velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);

        FS.divergence = FS.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, FS.gl.NEAREST);
        FS.curl       = FS.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, FS.gl.NEAREST);
        FS.pressure   = FS.createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, FS.gl.NEAREST);

        if (FS.initBloomFramebuffers) FS.initBloomFramebuffers();
        if (FS.initSunraysFramebuffers) FS.initSunraysFramebuffers();
    };

    FS.step = function (dt) {
        FS.gl.disable(FS.gl.BLEND);

        FS.curlProgram.bind();
        FS.gl.uniform2f(FS.curlProgram.uniforms.texelSize, FS.velocity.texelSizeX, FS.velocity.texelSizeY);
        FS.gl.uniform1i(FS.curlProgram.uniforms.uVelocity, FS.velocity.read.attach(0));
        FS.blit(FS.curl);

        FS.vorticityProgram.bind();
        FS.gl.uniform2f(FS.vorticityProgram.uniforms.texelSize, FS.velocity.texelSizeX, FS.velocity.texelSizeY);
        FS.gl.uniform1i(FS.vorticityProgram.uniforms.uVelocity, FS.velocity.read.attach(0));
        FS.gl.uniform1i(FS.vorticityProgram.uniforms.uCurl, FS.curl.attach(1));
        FS.gl.uniform1f(FS.vorticityProgram.uniforms.curl, FS.config.CURL);
        FS.gl.uniform1f(FS.vorticityProgram.uniforms.dt, dt);
        FS.blit(FS.velocity.write);
        FS.velocity.swap();

        FS.divergenceProgram.bind();
        FS.gl.uniform2f(FS.divergenceProgram.uniforms.texelSize, FS.velocity.texelSizeX, FS.velocity.texelSizeY);
        FS.gl.uniform1i(FS.divergenceProgram.uniforms.uVelocity, FS.velocity.read.attach(0));
        FS.blit(FS.divergence);

        FS.clearProgram.bind();
        FS.gl.uniform1i(FS.clearProgram.uniforms.uTexture, FS.pressure.read.attach(0));
        FS.gl.uniform1f(FS.clearProgram.uniforms.value, FS.config.PRESSURE);
        FS.blit(FS.pressure.write);
        FS.pressure.swap();

        FS.pressureProgram.bind();
        FS.gl.uniform2f(FS.pressureProgram.uniforms.texelSize, FS.velocity.texelSizeX, FS.velocity.texelSizeY);
        FS.gl.uniform1i(FS.pressureProgram.uniforms.uDivergence, FS.divergence.attach(0));
        for (let i = 0; i < FS.config.PRESSURE_ITERATIONS; i++) {
            FS.gl.uniform1i(FS.pressureProgram.uniforms.uPressure, FS.pressure.read.attach(1));
            FS.blit(FS.pressure.write);
            FS.pressure.swap();
        }

        FS.gradienSubtractProgram.bind();
        FS.gl.uniform2f(FS.gradienSubtractProgram.uniforms.texelSize, FS.velocity.texelSizeX, FS.velocity.texelSizeY);
        FS.gl.uniform1i(FS.gradienSubtractProgram.uniforms.uPressure, FS.pressure.read.attach(0));
        FS.gl.uniform1i(FS.gradienSubtractProgram.uniforms.uVelocity, FS.velocity.read.attach(1));
        FS.blit(FS.velocity.write);
        FS.velocity.swap();

        FS.advectionProgram.bind();
        FS.gl.uniform2f(FS.advectionProgram.uniforms.texelSize, FS.velocity.texelSizeX, FS.velocity.texelSizeY);
        if (!FS.ext.supportLinearFiltering)
            FS.gl.uniform2f(FS.advectionProgram.uniforms.dyeTexelSize, FS.velocity.texelSizeX, FS.velocity.texelSizeY);
        let velocityId = FS.velocity.read.attach(0);
        FS.gl.uniform1i(FS.advectionProgram.uniforms.uVelocity, velocityId);
        FS.gl.uniform1i(FS.advectionProgram.uniforms.uSource, velocityId);
        FS.gl.uniform1f(FS.advectionProgram.uniforms.dt, dt);
        FS.gl.uniform1f(FS.advectionProgram.uniforms.dissipation, FS.config.VELOCITY_DISSIPATION);
        FS.blit(FS.velocity.write);
        FS.velocity.swap();

        if (!FS.ext.supportLinearFiltering)
            FS.gl.uniform2f(FS.advectionProgram.uniforms.dyeTexelSize, FS.dye.texelSizeX, FS.dye.texelSizeY);
        FS.gl.uniform1i(FS.advectionProgram.uniforms.uVelocity, FS.velocity.read.attach(0));
        FS.gl.uniform1i(FS.advectionProgram.uniforms.uSource, FS.dye.read.attach(1));
        FS.gl.uniform1f(FS.advectionProgram.uniforms.dissipation, FS.config.DENSITY_DISSIPATION);
        FS.blit(FS.dye.write);
        FS.dye.swap();
    };

    FS.splat = function (x, y, dx, dy, color) {
        FS.splatProgram.bind();
        FS.gl.uniform1i(FS.splatProgram.uniforms.uTarget, FS.velocity.read.attach(0));
        FS.gl.uniform1f(FS.splatProgram.uniforms.aspectRatio, FS.canvas.width / FS.canvas.height);
        FS.gl.uniform2f(FS.splatProgram.uniforms.point, x, y);
        FS.gl.uniform3f(FS.splatProgram.uniforms.color, dx, dy, 0.0);
        FS.gl.uniform1f(FS.splatProgram.uniforms.radius, FS.correctRadius(FS.config.SPLAT_RADIUS / 100.0));
        FS.blit(FS.velocity.write);
        FS.velocity.swap();

        FS.gl.uniform1i(FS.splatProgram.uniforms.uTarget, FS.dye.read.attach(0));
        FS.gl.uniform3f(FS.splatProgram.uniforms.color, color.r, color.g, color.b);
        FS.blit(FS.dye.write);
        FS.dye.swap();
    };

    FS.splatPointer = function (pointer) {
        let dx = pointer.deltaX * FS.config.SPLAT_FORCE;
        let dy = pointer.deltaY * FS.config.SPLAT_FORCE;
        FS.splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
    };

    FS.multipleSplats = function (amount) {
        for (let i = 0; i < amount; i++) {
            const color = generateColor();
            color.r *= 10.0;
            color.g *= 10.0;
            color.b *= 10.0;
            const x = Math.random();
            const y = Math.random();
            const dx = 1000 * (Math.random() - 0.5);
            const dy = 1000 * (Math.random() - 0.5);
            FS.splat(x, y, dx, dy, color);
        }
    };

})(window.FluidSim = window.FluidSim || {});
