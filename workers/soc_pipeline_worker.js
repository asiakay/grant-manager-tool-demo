// Worker to batch SoC readings and persist to R2
const readings = [];

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    try {
      const data = await request.json();
      readings.push({ ...data, ts: Date.now() });
      const batchSize = Number(env.BATCH_SIZE) || 10;
      if (readings.length >= batchSize) {
        const key = `soc_batch_${Date.now()}.json`;
        await env.SOC_BUCKET.put(key, JSON.stringify(readings));
        readings.length = 0;
      }
      return new Response('accepted', { status: 202 });
    } catch (err) {
      return new Response('invalid payload', { status: 400 });
    }
  }
};
