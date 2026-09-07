/* Vul hier de twee gegevens van je Supabase-project in
   (Supabase → Project Settings → API). Laat je ze leeg, dan werkt
   de tikklok gewoon, maar enkel op dit ene toestel.

   De anon public key is bedoeld om publiek te zijn: hij geeft op zich
   geen toegang tot je uren. Die zijn beveiligd met Row Level Security,
   zodat enkel jouw eigen aangemelde account je eigen rijen kan lezen. */
window.TIKKLOK_CONFIG = {
  url:     "",   // bv. "https://abcdefghijkl.supabase.co"
  anonKey: ""    // bv. "eyJhbGciOiJIUzI1NiIs..."
};
