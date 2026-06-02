export default {
  async fetch(request, env) {
    // Let Workers Assets serve the file
    const response = await env.ASSETS.fetch(request);

    // Clone headers and inject COOP/COEP for SharedArrayBuffer support
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
