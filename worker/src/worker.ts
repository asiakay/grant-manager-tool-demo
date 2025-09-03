export interface Env {}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
  async fetch(request: Request): Promise<Response> {
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

    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
};
