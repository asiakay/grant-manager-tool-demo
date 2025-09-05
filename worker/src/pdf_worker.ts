/// <reference types="@cloudflare/workers-types" />

export interface Env {
  PDF_BUCKET: R2Bucket;
  GRANT_SUMMARIZER_URL: string;
  SCORE_QUEUE?: Queue;
}

export default {
  async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      const body = typeof message.body === 'string' ? { key: message.body } : message.body;
      const key = body?.key;
      if (!key) {
        console.error('Missing object key in message', message.body);
        message.ack();
        continue;
      }

      try {
        const obj = await env.PDF_BUCKET.get(key);
        if (!obj) {
          console.error(`PDF not found: ${key}`);
          message.ack();
          continue;
        }
        const pdfArray = await obj.arrayBuffer();

        const resp = await fetch(env.GRANT_SUMMARIZER_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/pdf' },
          body: pdfArray
        });
        if (!resp.ok) {
          throw new Error(`summarizer status ${resp.status}`);
        }
        const { csv, markdown } = await resp.json<{ csv: string; markdown: string }>();
        const base = key.replace(/\.pdf$/i, '');
        await env.PDF_BUCKET.put(`${base}.csv`, csv);
        await env.PDF_BUCKET.put(`${base}.md`, markdown);
        if (env.SCORE_QUEUE) {
          await env.SCORE_QUEUE.send({ file: `${base}.csv` });
        }
        message.ack();
      } catch (err) {
        console.error('Failed to process message', err);
        message.retry();
      }
    }
  }
};
