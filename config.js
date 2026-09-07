/* Vul hier de twee gegevens van je Supabase-project in
   (Supabase → Project Settings → API). Laat je ze leeg, dan werkt
   de tikklok gewoon, maar enkel op dit ene toestel.

   De anon public key is bedoeld om publiek te zijn: hij geeft op zich
   geen toegang tot je uren. Die zijn beveiligd met Row Level Security,
   zodat enkel jouw eigen aangemelde account je eigen rijen kan lezen. */
window.TIKKLOK_CONFIG = {
  url:     "https://ckwvcylqvwegdrkwlujg.supabase.co/rest/v1/",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrd3ZjeWxxdndlZ2Rya3dsdWpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3ODkzMjYsImV4cCI6MjEwNDM2NTMyNn0.jV80yscpIkQMJ1krNf4zyh6wZpcs8Mv0c_cQzTb9wSU"    // bv. "eyJhbGciOiJIUzI1NiIs..."
};
