export async function onRequestGet({ params, env }) {
  const d = params.d;
  const KV = env.WIKI_CACHE;
  const cacheKey = `wiki:${d}`;
  const relays = ['wss://relay.damus.io', 'wss://nos.lol']; // Add more if needed
  const TTL = 3600 * 1000; // 1 hour in ms

  // Check KV cache
  let cached = await KV.get(cacheKey);
  if (cached) {
    cached = JSON.parse(cached);
    if (Date.now() - cached.lastUpdated < TTL) {
      return new Response(JSON.stringify({ events: cached.events, fromCache: true }), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Fetch from relays if cache miss/stale
  const events = [];
  const reactionCounts = {};
  for (const relay of relays) {
    const ws = new WebSocket(relay);
    await new Promise(resolve => ws.addEventListener('open', resolve));
    
    // Subscribe to wiki articles
    const subId = 'wiki-' + Math.random().toString(36);
    ws.send(JSON.stringify(['REQ', subId, { kinds: [30818], '#d': [d], limit: 50 }]));
    
    const eventsPromise = new Promise(resolve => {
      ws.addEventListener('message', msg => {
        const data = JSON.parse(msg.data);
        if (data[0] === 'EVENT') {
          events.push(data[2]);
          // Fetch reactions for this event (simple + count)
          const reactionSub = 'reax-' + data[2].id;
          ws.send(JSON.stringify(['REQ', reactionSub, { kinds: [7], '#e': [data[2].id], limit: 100 }]));
          ws.addEventListener('message', reaxMsg => {
            const reaxData = JSON.parse(reaxMsg.data);
            if (reaxData[0] === 'EVENT' && reaxData[1] === reactionSub && reaxData[2].content === '+') {
              reactionCounts[data[2].id] = (reactionCounts[data[2].id] || 0) + 1;
            }
          });
        }
      });
      setTimeout(() => { ws.send(JSON.stringify(['CLOSE', subId])); resolve(); }, 5000); // Timeout to avoid hanging
    });
    await eventsPromise;
    ws.close();
  }

  // Dedupe events by id, add reaction counts
  const uniqueEvents = [...new Map(events.map(ev => [ev.id, ev])).values()];
  uniqueEvents.forEach(ev => ev.reactionCount = reactionCounts[ev.id] || 0);

  // Cache
  await KV.put(cacheKey, JSON.stringify({ events: uniqueEvents, lastUpdated: Date.now() }));

  return new Response(JSON.stringify({ events: uniqueEvents, fromCache: false }), { headers: { 'Content-Type': 'application/json' } });
}