export interface Env {
  PDF_BUCKET: R2Bucket;
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
  },

  async scheduled(event: any, env: Env): Promise<void> {
    const api = 'https://www.grants.gov/api/common/search2';
    const url = `${api}?keyword=water&limit=10`;
    const res = await fetch(url);
    const text = await res.text();
    await env.PDF_BUCKET.put('scheduled-search.json', text);
  }
};
