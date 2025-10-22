// functions/api/popular.js
export async function onRequestGet({ env }) {
  const KV = env.WIKI_CACHE;
  const cacheKey = 'popular';
  const relays = ['wss://relay.damus.io', 'wss://nos.lol'];
  const TTL = 3600 * 1000 * 24; // 24 hours

  let cached = await KV.get(cacheKey);
  if (cached) {
    cached = JSON.parse(cached);
    if (Date.now() - cached.lastUpdated < TTL) {
      return new Response(JSON.stringify({ articles: cached.articles, fromCache: true }), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Hardcoded list of known popular d tags (expand as needed)
  const popularDs = [
    'nostr', 'bitcoin', 'zaps', 'nip-01', 'nip-05', 'nip-07', 'nip-19', 'nip-26', 'nip-51', 'nip-54',
    'lightning', 'satoshi', 'pubkey', 'relays', 'notes', 'events', 'kind-1', 'kind-7', 'damus', 'primal',
    // ... (add more from the previous list as needed, up to ~1000)
  ];

  const articles = [];
  for (const d of popularDs) {
    const events = [];
    for (const relay of relays) {
      const ws = new WebSocket(relay);
      await new Promise(resolve => ws.addEventListener('open', resolve));

      const subId = 'pop-' + Math.random().toString(36);
      ws.send(JSON.stringify(['REQ', subId, { kinds: [30818], '#d': [d], limit: 1 }])); // Just latest per d

      const eventsPromise = new Promise(resolve => {
        ws.addEventListener('message', msg => {
          const data = JSON.parse(msg.data);
          if (data[0] === 'EVENT') events.push(data[2]);
        });
        setTimeout(() => { ws.send(JSON.stringify(['CLOSE', subId])); resolve(); }, 5000);
      });
      await eventsPromise;
      ws.close();
    }

    if (events.length) {
      let reactionCount = 0;
      for (const relay of relays) {
        const ws = new WebSocket(relay);
        await new Promise(resolve => ws.addEventListener('open', resolve));

        const reactionSub = 'reax-' + events[0].id;
        ws.send(JSON.stringify(['REQ', reactionSub, { kinds: [7], '#e': [events[0].id], limit: 100 }]));

        const reaxPromise = new Promise(resolve => {
          ws.addEventListener('message', msg => {
            const data = JSON.parse(msg.data);
            if (data[0] === 'EVENT' && data[2].content === '+') reactionCount++;
          });
          setTimeout(() => { ws.send(JSON.stringify(['CLOSE', reactionSub])); resolve(); }, 3000);
        });
        await reaxPromise;
        ws.close();
      }
      articles.push({ d, title: events[0].tags.find(t => t[0] === 'title')?.[1] || d, created_at: events[0].created_at, pubkey: events[0].pubkey, reactionCount });
    }
  }

  const uniqueArticles = articles.sort((a, b) => b.reactionCount - a.reactionCount);
  await KV.put(cacheKey, JSON.stringify({ articles: uniqueArticles, lastUpdated: Date.now() }));

  return new Response(JSON.stringify({ articles: uniqueArticles, fromCache: false }), { headers: { 'Content-Type': 'application/json' } });
}