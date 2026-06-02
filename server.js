const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8083;
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.tflite': 'application/octet-stream',
    '.data': 'application/octet-stream',
    '.binarypb': 'application/octet-stream',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const filePath = url === '/' ? '/index.html' : url;
    const fullPath = path.join(ROOT, filePath);

    // Security: prevent directory traversal
    if (!fullPath.startsWith(ROOT)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404);
            return res.end('Not found');
        }

        // Required for SharedArrayBuffer (MediaPipe WASM)
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Content-Type', contentType);

        res.writeHead(200);
        res.end(data);
    });
}).listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('With COOP/COEP headers for SharedArrayBuffer support');
});
