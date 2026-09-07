/* Service worker: houdt de app offline beschikbaar.
   Alleen bestanden van de app zelf worden gecachet; oproepen naar
   Supabase gaan altijd rechtstreeks naar het netwerk. */
var VERSIE = "tikklok-v2";
var SCHIL = [
  "./", "./index.html", "./app.js", "./config.js", "./vendor/supabase.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/favicon-64.png"
];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(VERSIE).then(function(c){ return c.addAll(SCHIL); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(namen){
    return Promise.all(namen.map(function(n){ return n===VERSIE ? null : caches.delete(n); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener("fetch", function(e){
  var url = new URL(e.request.url);
  if(e.request.method !== "GET") return;
  if(url.origin !== self.location.origin) return;          // Supabase en lettertypes: niet aanraken

  if(e.request.mode === "navigate"){
    e.respondWith(
      fetch(e.request).then(function(r){
        var kopie = r.clone();
        caches.open(VERSIE).then(function(c){ c.put("./index.html", kopie); });
        return r;
      }).catch(function(){ return caches.match("./index.html"); })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function(hit){
      var net = fetch(e.request).then(function(r){
        if(r && r.status === 200){
          var kopie = r.clone();
          caches.open(VERSIE).then(function(c){ c.put(e.request, kopie); });
        }
        return r;
      }).catch(function(){ return hit; });
      return hit || net;
    })
  );
});
