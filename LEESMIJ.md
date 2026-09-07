# Tikklok — installatie

Een losstaande app voor je urenregistratie. Werkt offline, installeert als
echte app op iPhone en pc, en houdt je uren gelijk tussen je toestellen via
Supabase.

Zonder Supabase werkt hij ook — dan bewaart elk toestel zijn eigen uren.
Reken op een halfuurtje voor de volledige installatie.

---

## 1. Supabase-project aanmaken (± 10 min)

1. Ga naar **supabase.com** → *Start your project* → **Continue with GitHub**.
2. *New project*:
   - Naam: `tikklok`
   - Database Password: laat er één genereren en bewaar hem in je wachtwoordkluis
   - Region: **Central EU (Frankfurt)** — dichtstbij en binnen de EU
3. Wacht tot het project klaar is (± 2 minuten).
4. Ga naar **SQL Editor** → *New query* → plak de volledige inhoud van
   `supabase-setup.sql` → **Run**. Je zou "Success" moeten zien.
   Dit maakt twee tabellen aan en zet Row Level Security aan, zodat enkel
   jouw eigen aangemelde account je eigen rijen kan lezen of schrijven.
5. Ga naar **Project Settings → API** (of *API Keys*) en kopieer:
   - **Project URL** — ziet eruit als `https://abcdefghijkl.supabase.co`
   - **anon public** key — een lange tekst die met `eyJ...` begint
6. Open `config.js` in een teksteditor en vul die twee waarden in tussen de
   aanhalingstekens. Bewaren.

> De anon key hoort publiek te zijn; hij geeft op zichzelf geen toegang tot je
> uren. Die zijn beveiligd met de policies uit stap 4: zonder aangemeld te zijn
> kom je aan geen enkele rij.

**Tip:** wil je liever niet wachten op een bevestigingsmail bij het aanmaken van
je account, zet dan in **Authentication → Sign In / Providers → Email** de optie
*Confirm email* uit.

---

## 2. Op GitHub Pages zetten (± 10 min)

1. Maak op GitHub een nieuwe repository, bijvoorbeeld `tikklok`.
   Kies **Public** — GitHub Pages is enkel gratis op publieke repositories.
   Publiek betekent: de code van de app is zichtbaar, je uren niet. Die staan
   in Supabase achter je aanmelding.
2. *Add file → Upload files*. Sleep **alle** bestanden hierin, inclusief de
   mappen `icons/` en `vendor/`. Commit.
3. *Settings → Pages* → Source: **Deploy from a branch** → branch `main`,
   map `/ (root)` → **Save**.
4. Na ongeveer een minuut staat je app op
   `https://JOUWNAAM.github.io/tikklok/`

Liever niet publiek? Dan werkt **Netlify Drop** even goed: ga naar
`app.netlify.com/drop` en sleep de hele map in het venster. Je krijgt meteen
een adres en niets staat publiek.

---

## 3. Account aanmaken en aanmelden

1. Open je nieuwe adres in de browser.
2. Klik op **Synchronisatie** → vul je e-mailadres en een wachtwoord in →
   **Account aanmaken**.
3. Bevestig eventueel de mail van Supabase en meld je daarna aan.
4. Doe hetzelfde op je andere toestel — met **hetzelfde adres**. Vanaf dan
   lopen je uren gelijk.

De bovenste regel in de app toont de stand: *Gesynchroniseerd om 14:32*,
*Synchroniseren…* of *Niet gesynchroniseerd · 2 wijzigingen wachten*.
Wat je offline invult, gaat automatisch mee zodra je weer verbinding hebt.

---

## 4. Als app installeren

**iPhone** (moet via Safari, Chrome kan dit niet):
deel-knop onderaan → *Zet op beginscherm* → naam `Tikklok` → *Voeg toe*.
Hij opent daarna zonder browserbalk, met het eigen icoon.

**Windows / Mac, Chrome of Edge:**
klik het installatie-icoontje rechts in de adresbalk, of menu → *Apps* →
*Deze site als app installeren*. Daarna kan je hem aan je taakbalk vastmaken.

---

## 5. Later iets wijzigen

Pas het bestand op GitHub aan (potloodje → Commit) en Pages publiceert het
vanzelf. De app haalt de nieuwe versie op bij het volgende openen; soms moet je
hem één keer sluiten en heropenen voor je de wijziging ziet.

---

## Wat zit waarin

| Bestand | Waarvoor |
|---|---|
| `index.html` | De pagina zelf: opmaak en structuur |
| `app.js` | Alle logica: klok, saldo, feestdagen, synchronisatie |
| `config.js` | **Jouw** twee Supabase-gegevens |
| `sw.js` | Service worker — zorgt dat de app offline werkt |
| `manifest.webmanifest` | Maakt er een installeerbare app van |
| `vendor/supabase.js` | De Supabase-bibliotheek, meegeleverd zodat je offline niets nodig hebt |
| `icons/` | App-icoon in de nodige maten |
| `supabase-setup.sql` | Het script uit stap 1.4 |

---

## Hoe de uren berekend worden

- **Dagnorm** = uren per week ÷ 5, van maandag tot vrijdag. Standaard 40 u/week,
  dus 8u00 per dag. Aan te passen bij *Instellingen*.
- **Weekends en Belgische feestdagen** hebben geen norm. De feestdagen worden
  berekend, ook de bewegende (Pasen, Hemelvaart, Pinksteren), dus ook juist voor
  volgende jaren.
- **Verlof, ziekte en opleidingsverlof** vullen de dagnorm aan: zo'n dag levert
  geen tekort op.
- **Recup** telt als gewerkte tijd nul en gaat dus van je opgebouwd saldo af.
- **Pauze** gaat er automatisch af vanaf zes uur klokken. Werk je door, dan zet
  je dat per dag uit met de pauzeknop.
- Je **saldo telt pas vanaf je eerste registratie** — de dagen daarvoor blijven
  buiten beschouwing. Vergeet je later een werkdag, dan zie je die wél als
  tekort staan.
