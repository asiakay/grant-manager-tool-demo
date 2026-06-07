/**
 * PDF Processing Queue Worker (under development — not deployed)
 *
 * Purpose: Cloudflare Queue consumer that picks up PDFs uploaded to R2,
 * calls the grant_summarizer service to extract structured data, and writes
 * CSV + Markdown back to R2. Optionally enqueues the resulting CSV for
 * downstream scoring.
 *
 * To deploy this worker you will need to provision:
 *   1. An R2 bucket bound as PDF_BUCKET
 *   2. A Cloudflare Queue (producer + consumer) — pass the CSV key via message body
 *   3. A deployed GRANT_SUMMARIZER_URL endpoint (see grant_summarizer/ for the
 *      Python implementation; host it as a Worker or external service)
 *   4. Optionally a second Queue bound as SCORE_QUEUE for downstream scoring
 *
 * Wire up in a dedicated wrangler.toml, e.g.:
 *   name = "pdf-worker"
 *   main = "drafts/pdf_worker.ts"
 *   [[queues.consumers]]
 *   queue = "pdf-ingest"
 *   max_batch_size = 10
 */

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
          body: pdfArray,
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
  },
};
