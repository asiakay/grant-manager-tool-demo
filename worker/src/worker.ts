/// <reference types="@cloudflare/workers-types" />

interface AiBinding {
  run(model: string, input: unknown): Promise<any>;
}

export interface Env {
  PDF_BUCKET: R2Bucket;
  AI: AiBinding;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/') {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Grant Manager API</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
    h1 { color: #2563eb; }
    h2 { color: #1e40af; margin-top: 2em; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f3f4f6; padding: 15px; border-radius: 5px; overflow-x: auto; }
    .endpoint { margin: 1em 0; padding: 1em; border-left: 3px solid #2563eb; background: #f9fafb; }
    .method { display: inline-block; padding: 2px 8px; border-radius: 3px; font-weight: bold; font-size: 0.85em; }
    .get { background: #10b981; color: white; }
    .post { background: #3b82f6; color: white; }
  </style>
</head>
<body>
  <h1>Grant Manager API</h1>
  <p>Welcome to the Grant Manager Tool API. This service provides endpoints for grant scoring, PDF processing, and AI-powered grant analysis.</p>

  <h2>Available Endpoints</h2>

  <div class="endpoint">
    <span class="method get">GET</span> <code>/api/health</code>
    <p>Health check endpoint. Returns <code>{"ok": true}</code> if the service is running.</p>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span> <code>/api/score</code>
    <p>Simple scoring endpoint that doubles the input value.</p>
    <pre>Request: {"value": 42}
Response: {"doubled": 84}</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span> <code>/api/chat</code>
    <p>AI-powered chat using Cloudflare AI (Llama-3-8B model). Ask questions about grants.</p>
    <pre>Request: {"message": "What is this grant about?"}
Response: {"response": "..."}</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span> <code>/upload</code>
    <p>Upload a PDF file to R2 storage. Accepts multipart/form-data or JSON with base64 data.</p>
    <pre>Multipart: file field with PDF
JSON: {"name": "grant.pdf", "data": "base64..."}</pre>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span> <code>/pdf/:name</code>
    <p>Retrieve a PDF file from R2 storage by filename.</p>
  </div>

  <h2>Resources</h2>
  <ul>
    <li><a href="https://github.com/asiakay/grant-manager-tool-demo">GitHub Repository</a></li>
    <li><a href="/api/health">Test Health Check</a></li>
  </ul>
</body>
</html>`;
      return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }

    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' }
      });
    }

    if (url.pathname === '/api/score') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
      }
      let data: any;
      try {
        data = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400,
          headers: { ...corsHeaders, 'content-type': 'application/json' }
        });
      }
      const value = Number(data?.value);
      if (!Number.isFinite(value)) {
        return new Response(JSON.stringify({ error: '`value` must be a number' }), {
          status: 400,
          headers: { ...corsHeaders, 'content-type': 'application/json' }
        });
      }
      const score = value * 2;
      return new Response(JSON.stringify({ score }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' }
      });
    }

    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
      }
      let data: any;
      try {
        data = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400,
          headers: { ...corsHeaders, 'content-type': 'application/json' }
        });
      }
      const prompt = data?.prompt;
      if (typeof prompt !== 'string') {
        return new Response(JSON.stringify({ error: '`prompt` must be a string' }), {
          status: 400,
          headers: { ...corsHeaders, 'content-type': 'application/json' }
        });
      }
      const result = await env.AI.run('@cf/meta/llama-3-8b-instruct', { prompt });
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'content-type': 'application/json' }
      });
    }

    if (url.pathname === '/upload') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
      }
      const contentType = request.headers.get('content-type') || '';
      let name: string;
      if (contentType.includes('multipart/form-data')) {
        const form = await request.formData();
        const file = form.get('file');
        if (!(file instanceof File)) {
          return new Response('File not provided', { status: 400, headers: corsHeaders });
        }
        name = form.get('name')?.toString() || file.name;
        await env.PDF_BUCKET.put(name, file.stream());
      } else {
        let data: any;
        try {
          data = await request.json();
        } catch {
          return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
        }
        name = data?.name;
        const base64 = data?.data;
        if (typeof name !== 'string' || typeof base64 !== 'string') {
          return new Response('`name` and `data` are required', { status: 400, headers: corsHeaders });
        }
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        await env.PDF_BUCKET.put(name, bytes);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' }
      });
    }

    const pdfMatch = url.pathname.match(/^\/pdf\/(.+)$/);
    if (pdfMatch) {
      const object = await env.PDF_BUCKET.get(pdfMatch[1]);
      if (!object) {
        return new Response('Not found', { status: 404, headers: corsHeaders });
      }
      return new Response(object.body, {
        headers: { ...corsHeaders, 'content-type': 'application/pdf' }
      });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
};
