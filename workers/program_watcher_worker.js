// Stub Cloudflare Worker
export default {
  async fetch(request) {
    return new Response(JSON.stringify({status:'ok', agent:'ProgramWatcher'}));
  }
}
