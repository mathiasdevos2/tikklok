/* Tikklok — persoonlijke urenregistratie.
   Lokaal-eerst: alles staat in localStorage en werkt offline.
   Staat er een Supabase-configuratie klaar en ben je aangemeld, dan
   synchroniseert hij je uren tussen je toestellen. */
(function(){
  "use strict";

  /* ---------------- constanten ---------------- */
  var DAGNAMEN=["zo","ma","di","wo","do","vr","za"];
  var MAANDEN=["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
  var TYPES={
    gewerkt:{label:"Gewerkt",klasse:"c-gewerkt"},
    verlof:{label:"Verlof",klasse:"c-verlof"},
    ziekte:{label:"Ziekte",klasse:"c-ziekte"},
    vov:{label:"Opleidingsverlof",klasse:"c-vov"},
    recup:{label:"Recup",klasse:"c-recup"},
    feestdag:{label:"Feestdag",klasse:"c-feestdag"}
  };
  var AANVULLEND={verlof:1,ziekte:1,vov:1};

  /* ---------------- hulpjes ---------------- */
  function pad(n){ return (n<10?"0":"")+n; }
  function sleutel(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
  function uitSleutel(s){ var p=s.split("-"); return new Date(+p[0],+p[1]-1,+p[2]); }
  function naarMin(h){ if(!h) return null; var p=h.split(":"); return (+p[0])*60+(+p[1]); }
  function naarHhmm(m){ m=((m%1440)+1440)%1440; return pad(Math.floor(m/60))+":"+pad(m%60); }
  function uren(min){ var neg=min<0,m=Math.abs(Math.round(min)); return (neg?"−":"")+Math.floor(m/60)+"u"+pad(m%60); }
  function urenDec(min){ return (min/60).toFixed(2).replace(".",","); }
  function nuIso(){ return new Date().toISOString(); }
  function isoWeek(d){
    var t=new Date(d.getFullYear(),d.getMonth(),d.getDate());
    t.setDate(t.getDate()+3-((t.getDay()+6)%7));
    var w1=new Date(t.getFullYear(),0,4);
    return 1+Math.round(((t-w1)/86400000-3+((w1.getDay()+6)%7))/7);
  }
  function maandagVan(d){
    var t=new Date(d.getFullYear(),d.getMonth(),d.getDate());
    t.setDate(t.getDate()-((t.getDay()+6)%7)); return t;
  }
  function plusDagen(d,n){ var t=new Date(d.getFullYear(),d.getMonth(),d.getDate()); t.setDate(t.getDate()+n); return t; }

  /* ---------------- Belgische feestdagen ---------------- */
  function pasen(j){
    var a=j%19,b=Math.floor(j/100),c=j%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),
        g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,
        l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
        mnd=Math.floor((h+l-7*m+114)/31),dag=((h+l-7*m+114)%31)+1;
    return new Date(j,mnd-1,dag);
  }
  var feestcache={};
  function feestdagen(j){
    if(feestcache[j]) return feestcache[j];
    var p=pasen(j),map={};
    function zet(d,n){ map[sleutel(d)]=n; }
    zet(new Date(j,0,1),"Nieuwjaar");
    zet(plusDagen(p,1),"Paasmaandag");
    zet(new Date(j,4,1),"Dag van de Arbeid");
    zet(plusDagen(p,39),"O.H. Hemelvaart");
    zet(plusDagen(p,50),"Pinkstermaandag");
    zet(new Date(j,6,21),"Nationale feestdag");
    zet(new Date(j,7,15),"O.L.V. Hemelvaart");
    zet(new Date(j,10,1),"Allerheiligen");
    zet(new Date(j,10,11),"Wapenstilstand");
    zet(new Date(j,11,25),"Kerstmis");
    feestcache[j]=map; return map;
  }
  function feestNaam(k){ return feestdagen(+k.slice(0,4))[k]||null; }

  /* ---------------- toestand ---------------- */
  var STANDAARD={urenPerWeek:40,standaardPauze:30,standaardBegin:"08:00",standaardEinde:"16:30"};
  var instellingen=Object.assign({},STANDAARD);
  var dagen=Object.create(null);
  var vuil=Object.create(null);          // dagen die nog naar de server moeten
  var instellingenVuil=false;
  var weergave=(window.innerWidth<700)?"week":"maand";
  var anker=new Date();
  var vandaagK=sleutel(new Date());
  var startK=null;

  var SB=null, sessie=null, syncStand="uit", syncFout="", laatsteSync=null, syncTimer=null;

  function leegDag(k){
    return {datum:k,type:feestNaam(k)?"feestdag":"gewerkt",blokken:[],pauze:0,pauzeModus:"auto",notitie:""};
  }
  function bestaat(k){ var d=dagen[k]; return !!d && !d.verwijderd; }
  function haalDag(k){ return bestaat(k)?dagen[k]:leegDag(k); }
  function heeftInhoud(d){
    return (d.blokken&&d.blokken.length)||d.pauze>0||(d.notitie&&d.notitie.trim())||
           (d.pauzeModus&&d.pauzeModus!=="auto")||(d.type&&d.type!==leegDag(d.datum).type);
  }

  /* ---------------- rekenwerk ---------------- */
  function blokMin(b,nu){
    var s=naarMin(b.start); if(s===null) return 0;
    if(b.eind){ var m=naarMin(b.eind)-s; if(m<0) m+=1440; return m; }
    if(b.startTs) return Math.max(0,((nu||Date.now())-b.startTs)/60000);
    var n=new Date(),m2=(n.getHours()*60+n.getMinutes())-s; if(m2<0) m2+=1440; return m2;
  }
  function brutoMin(d,nu){ var t=0; (d.blokken||[]).forEach(function(b){ t+=blokMin(b,nu||Date.now()); }); return t; }
  function effPauze(d,nu){
    if(d.pauzeModus==="geen") return 0;
    if(d.pauzeModus==="handmatig") return Math.max(0,d.pauze||0);
    return brutoMin(d,nu)>360 ? instellingen.standaardPauze : 0;
  }
  function nettoMin(d,nu){ return Math.max(0,brutoMin(d,nu)-effPauze(d,nu)); }
  function dagnorm(){ return instellingen.urenPerWeek*60/5; }
  function normVan(k,d){
    var dw=uitSleutel(k).getDay();
    if(dw===0||dw===6) return 0;
    if(d.type==="feestdag") return 0;
    return dagnorm();
  }
  function creditVan(k,d,nu){
    var n=nettoMin(d,nu);
    if(AANVULLEND[d.type]) return Math.max(n,normVan(k,d));
    return n;
  }
  function loopendBlok(d){
    var bs=d.blokken||[];
    for(var i=0;i<bs.length;i++){ if(!bs[i].eind) return bs[i]; }
    return null;
  }
  function teltMee(k){ return k<=vandaagK && !!startK && k>=startK; }
  function bepaalStart(){
    var min=null;
    for(var k in dagen){ if(dagen[k]&&!dagen[k].verwijderd&&(!min||k<min)) min=k; }
    startK=min;
  }
  function somOver(vanD,totD){
    var g=0,n=0,nt=0,nu=Date.now();
    var c=new Date(vanD.getFullYear(),vanD.getMonth(),vanD.getDate());
    while(c<=totD){
      var k=sleutel(c),d=haalDag(k),nv=normVan(k,d);
      g+=creditVan(k,d,nu); n+=nv; if(teltMee(k)) nt+=nv;
      c.setDate(c.getDate()+1);
    }
    return {gepresteerd:g,norm:n,normTot:nt,saldo:g-nt};
  }

  /* ---------------- lokale opslag ---------------- */
  var LS_D="tikklok.dagen",LS_I="tikklok.instellingen",LS_V="tikklok.vuil",LS_C="tikklok.config";
  function lokaalLees(){
    try{
      var d=localStorage.getItem(LS_D); if(d) dagen=JSON.parse(d)||Object.create(null);
      var i=localStorage.getItem(LS_I); if(i) instellingen=Object.assign({},STANDAARD,JSON.parse(i)||{});
      var v=localStorage.getItem(LS_V);
      if(v){ var pv=JSON.parse(v)||{}; vuil=pv.dagen||Object.create(null); instellingenVuil=!!pv.instellingen; }
    }catch(e){}
  }
  function lokaalSchrijf(){
    try{
      localStorage.setItem(LS_D,JSON.stringify(dagen));
      localStorage.setItem(LS_I,JSON.stringify(instellingen));
      localStorage.setItem(LS_V,JSON.stringify({dagen:vuil,instellingen:instellingenVuil}));
    }catch(e){ melding("Kon niet lokaal bewaren — is de opslag vol?"); }
  }
  function normaliseer(k,data){
    data=data||{};
    return {
      datum:k,
      type:TYPES[data.type]?data.type:"gewerkt",
      pauze:typeof data.pauze==="number"?data.pauze:0,
      pauzeModus:(data.pauzeModus==="geen"||data.pauzeModus==="handmatig"||data.pauzeModus==="auto")
        ? data.pauzeModus
        : ((typeof data.pauze==="number"&&data.pauze>0)?"handmatig":"auto"),
      notitie:typeof data.notitie==="string"?data.notitie:"",
      bijgewerkt:typeof data.bijgewerkt==="string"?data.bijgewerkt:nuIso(),
      blokken:Array.isArray(data.blokken)?data.blokken.filter(function(b){ return b&&b.start; }).map(function(b){
        return {start:String(b.start),eind:b.eind?String(b.eind):null,
                startTs:typeof b.startTs==="number"?b.startTs:null};
      }):[]
    };
  }
  function inHetNederlands(e){
    var m=(e&&(e.message||e.error_description||e.msg))||"";
    if(/failed to fetch|networkerror|fetch/i.test(m))
      return "Geen verbinding met de server. Klopt de project-URL, en heb je internet?";
    if(/invalid login credentials/i.test(m)) return "E-mailadres of wachtwoord klopt niet.";
    if(/email not confirmed/i.test(m)) return "Bevestig eerst de e-mail die Supabase je stuurde.";
    if(/already registered|already been registered/i.test(m)) return "Er bestaat al een account met dit adres — meld je gewoon aan.";
    if(/password should be at least/i.test(m)) return "Het wachtwoord is te kort: minstens zes tekens.";
    if(/rate limit|too many requests/i.test(m)) return "Te veel pogingen na elkaar. Probeer over een minuutje opnieuw.";
    if(/does not exist|relation .* does not exist|schema cache/i.test(m))
      return "De tabellen bestaan nog niet. Draai supabase-setup.sql in de SQL Editor van Supabase.";
    if(/row-level security|permission denied/i.test(m)) return "Geen toegang tot je rijen. Draai supabase-setup.sql opnieuw.";
    return m||"onbekende fout";
  }
  function melding(t){
    var el=document.createElement("div"); el.className="melding"; el.textContent=t;
    document.body.appendChild(el); setTimeout(function(){ el.remove(); },3400);
  }

  function bewaarDag(k){
    var d=dagen[k];
    if(d&&!d.verwijderd&&!heeftInhoud(d)) d=null;
    if(d){ d.bijgewerkt=nuIso(); dagen[k]=d; }
    else if(dagen[k]) dagen[k]={datum:k,verwijderd:true,bijgewerkt:nuIso()};
    vuil[k]=true;
    lokaalSchrijf(); tekenAlles(); planSync();
  }
  function bewaarInstellingen(){
    instellingen.bijgewerkt=nuIso(); instellingenVuil=true;
    lokaalSchrijf(); tekenAlles(); planSync();
  }

  /* ---------------- synchronisatie ---------------- */
  function config(){
    var c=window.TIKKLOK_CONFIG||{};
    try{ var l=JSON.parse(localStorage.getItem(LS_C)||"null"); if(l&&l.url&&l.anonKey) c=l; }catch(e){}
    return {url:(c.url||"").trim(), anonKey:(c.anonKey||"").trim()};
  }
  function configOk(){ var c=config(); return !!(c.url&&c.anonKey); }
  function aantalVuil(){ return Object.keys(vuil).length+(instellingenVuil?1:0); }

  function zetSync(stand,fout){
    syncStand=stand; syncFout=fout||"";
    var stip=document.getElementById("syncStip"), tekst=document.getElementById("syncTekst");
    stip.className="syncstip "+(stand==="ok"?"ok":stand==="bezig"?"bezig":
                    (stand==="fout"||stand==="bibliotheek")?"fout":"uit");
    var n=aantalVuil();
    if(stand==="ok"){
      var t=laatsteSync?(pad(laatsteSync.getHours())+":"+pad(laatsteSync.getMinutes())):"";
      tekst.textContent="Gesynchroniseerd"+(t?" om "+t:"");
    }else if(stand==="bezig") tekst.textContent="Synchroniseren…";
    else if(stand==="fout") tekst.textContent="Niet gesynchroniseerd"+(n?" · "+n+" wijziging"+(n===1?"":"en")+" wacht":"");
    else if(stand==="aanmelden") tekst.textContent="Nog niet aangemeld — tik op Synchronisatie";
    else if(stand==="bibliotheek") tekst.textContent="Synchronisatie kan niet starten — tik op Synchronisatie";
    else tekst.textContent="Alleen op dit toestel bewaard";
  }

  function maakClient(){
    var c=config();
    if(!c.url||!c.anonKey||!window.supabase){ SB=null; return false; }
    try{
      SB=window.supabase.createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});
      return true;
    }catch(e){ SB=null; return false; }
  }

  function bibliotheekAanwezig(){ return !!(window.supabase && window.supabase.createClient); }
  function zorgVoorClient(){ if(!SB) maakClient(); return !!SB; }

  async function startSync(){
    if(!maakClient()){ zetSync(configOk()&&!bibliotheekAanwezig() ? "bibliotheek" : "uit"); return; }
    try{
      var r=await SB.auth.getSession();
      sessie=(r&&r.data&&r.data.session)||null;
    }catch(e){ sessie=null; }
    SB.auth.onAuthStateChange(function(_e,s){
      sessie=s||null;
      if(sessie) synchroniseer(); else zetSync("aanmelden");
      if(!document.getElementById("overlay").hidden && huidigeKaart==="account") openAccount();
    });
    if(sessie) synchroniseer(); else zetSync("aanmelden");
  }

  function planSync(){
    if(!SB||!sessie) { zetSync(SB?"aanmelden":"uit"); return; }
    clearTimeout(syncTimer);
    syncTimer=setTimeout(function(){ synchroniseer(true); },1200);
  }

  var syncBezig=false;
  async function synchroniseer(stil){
    if(!SB||!sessie||syncBezig) return;
    if(!navigator.onLine){ zetSync("fout"); return; }
    syncBezig=true; zetSync("bezig");
    try{
      var uid=sessie.user.id;

      var teDuwen=Object.keys(vuil);
      if(teDuwen.length){
        var rijen=teDuwen.map(function(k){
          var d=dagen[k]||{datum:k,verwijderd:true,bijgewerkt:nuIso()};
          return {user_id:uid,datum:k,data:d,bijgewerkt:d.bijgewerkt||nuIso()};
        });
        var up=await SB.from("tikklok_dagen").upsert(rijen,{onConflict:"user_id,datum"});
        if(up.error) throw up.error;
        teDuwen.forEach(function(k){ delete vuil[k]; });
      }
      if(instellingenVuil){
        var ui=await SB.from("tikklok_instellingen")
          .upsert([{user_id:uid,data:instellingen,bijgewerkt:instellingen.bijgewerkt||nuIso()}],{onConflict:"user_id"});
        if(ui.error) throw ui.error;
        instellingenVuil=false;
      }

      var res=await SB.from("tikklok_dagen").select("datum,data,bijgewerkt");
      if(res.error) throw res.error;
      var veranderd=false;
      (res.data||[]).forEach(function(rij){
        var op=(rij.data&&rij.data.bijgewerkt)||rij.bijgewerkt||"";
        var lok=dagen[rij.datum];
        var lokT=(lok&&lok.bijgewerkt)||"";
        if(vuil[rij.datum]) return;
        if(lok&&lokT>=op) return;
        if(rij.data&&rij.data.verwijderd){
          if(lok&&!lok.verwijderd){ dagen[rij.datum]={datum:rij.datum,verwijderd:true,bijgewerkt:op}; veranderd=true; }
        }else{
          dagen[rij.datum]=normaliseer(rij.datum,rij.data);
          dagen[rij.datum].bijgewerkt=op||nuIso();
          veranderd=true;
        }
      });

      if(!instellingenVuil){
        var ri=await SB.from("tikklok_instellingen").select("data,bijgewerkt").eq("user_id",uid).maybeSingle();
        if(!ri.error&&ri.data&&ri.data.data){
          var opI=(ri.data.data.bijgewerkt)||ri.data.bijgewerkt||"";
          if(!instellingen.bijgewerkt||opI>instellingen.bijgewerkt){
            instellingen=Object.assign({},STANDAARD,ri.data.data);
            veranderd=true;
          }
        }
      }

      lokaalSchrijf();
      laatsteSync=new Date(); zetSync("ok");
      if(veranderd) tekenAlles();
    }catch(e){
      zetSync("fout",inHetNederlands(e));
      if(!stil) melding("Synchroniseren mislukt: "+inHetNederlands(e));
    }finally{ syncBezig=false; }
  }

  /* ---------------- tekenen ---------------- */
  function tekenKlok(){
    var d=haalDag(vandaagK),nu=Date.now(),lb=loopendBlok(d);
    var ms=Math.max(0,brutoMin(d,nu)*60000-effPauze(d,nu)*60000),s=Math.floor(ms/1000);
    var dig=document.getElementById("digits");
    dig.textContent=Math.floor(s/3600)+":"+pad(Math.floor(s/60)%60)+":"+pad(s%60);
    dig.classList.toggle("loopt",!!lb);
    document.getElementById("stip").classList.toggle("loopt",!!lb);
    document.getElementById("statusTekst").textContent=lb?("Ingeklokt sinds "+lb.start):"Uitgeklokt";

    var norm=normVan(vandaagK,d);
    document.getElementById("subdigits").textContent = norm>0
      ? ("netto vandaag · norm "+uren(norm)+
         (teltMee(vandaagK)?(" · saldo "+uren(creditVan(vandaagK,d,nu)-norm)):""))
      : ("netto vandaag · geen norm ("+(d.type==="feestdag"?(feestNaam(vandaagK)||"feestdag"):"weekend")+")");

    var btn=document.getElementById("btnKlok");
    btn.textContent=lb?"Uitklokken":"Inklokken";
    btn.classList.toggle("stop",!!lb);

    var ep=effPauze(d,nu),pb=document.getElementById("btnPauze");
    pb.textContent = d.pauzeModus==="geen" ? "Doorgewerkt · geen pauze"
                   : (d.pauzeModus==="handmatig" ? ("Pauze "+ep+" min")
                   : (ep>0?("Pauze "+ep+" min · auto"):"Pauze automatisch"));
    pb.setAttribute("aria-pressed",d.pauzeModus==="geen"?"true":"false");

    var bj=document.getElementById("blokjes"); bj.innerHTML="";
    if(!(d.blokken||[]).length){
      var l=document.createElement("span"); l.className="klok-leeg";
      l.textContent = d.type==="gewerkt" ? "Nog geen prestaties vandaag." : TYPES[d.type].label+" — geen prestaties.";
      bj.appendChild(l);
    }else{
      d.blokken.forEach(function(b){
        var e=document.createElement("span"); e.className="blokje"+(b.eind?"":" open");
        e.textContent=b.start+" – "+(b.eind||"…"); bj.appendChild(e);
      });
      var p=document.createElement("span"); p.className="blokje";
      p.textContent = ep>0 ? ("pauze "+ep+" min") : (d.pauzeModus==="geen"?"doorgewerkt":"pauze auto");
      bj.appendChild(p);
    }
    var vd=new Date();
    document.getElementById("vandaagDatum").textContent=DAGNAMEN[vd.getDay()]+" "+vd.getDate()+" "+MAANDEN[vd.getMonth()];
  }

  function tekenStand(){
    var ma=maandagVan(new Date()),w=somOver(ma,plusDagen(ma,6));
    document.getElementById("wGepresteerd").textContent=uren(w.gepresteerd);
    document.getElementById("wVerwacht").textContent=uren(w.norm);
    var ws=document.getElementById("wSaldo");
    ws.textContent=uren(w.saldo); ws.className="val "+(w.saldo<0?"negatief":"pos");

    var m=somOver(new Date(anker.getFullYear(),anker.getMonth(),1),new Date(anker.getFullYear(),anker.getMonth()+1,0));
    document.getElementById("mSaldoLabel").textContent="Saldo "+MAANDEN[anker.getMonth()];
    var ms=document.getElementById("mSaldo");
    ms.textContent=uren(m.saldo); ms.className="val "+(m.saldo<0?"negatief":"pos");

    document.getElementById("normNoot").textContent=
      instellingen.urenPerWeek+" u/week · dagnorm "+uren(dagnorm())+" · pauze "+instellingen.standaardPauze+
      " min vanaf 6 u · standaarddag "+instellingen.standaardBegin+"–"+instellingen.standaardEinde;
  }

  function periode(){
    if(weergave==="week"){
      var ma=maandagVan(anker),zo=plusDagen(ma,6);
      return {van:ma,tot:zo,
        titel:"Week "+isoWeek(ma)+" · "+ma.getDate()+" "+MAANDEN[ma.getMonth()]+" – "+zo.getDate()+" "+MAANDEN[zo.getMonth()]};
    }
    var v=new Date(anker.getFullYear(),anker.getMonth(),1);
    var t=new Date(anker.getFullYear(),anker.getMonth()+1,0);
    return {van:v,tot:t,
      titel:MAANDEN[v.getMonth()].charAt(0).toUpperCase()+MAANDEN[v.getMonth()].slice(1)+" "+v.getFullYear()};
  }

  function tekenBlad(){
    var p=periode(),body=document.getElementById("tabelBody");
    document.getElementById("bladTitel").textContent=p.titel;
    document.getElementById("btnWeek").setAttribute("aria-pressed",weergave==="week"?"true":"false");
    document.getElementById("btnMaand").setAttribute("aria-pressed",weergave==="maand"?"true":"false");
    body.innerHTML="";

    var nu=Date.now(),wk=null,wNr=null,wSom={g:0,n:0,nt:0};
    function weekrij(){
      if(wNr===null) return;
      var tr=document.createElement("tr"); tr.className="wsom";
      var td=document.createElement("td"); td.colSpan=3; td.textContent="Week "+wNr; tr.appendChild(td);
      [["","k-pauze"],[uren(wSom.g),""],[uren(wSom.n),"k-norm"],
       [uren(wSom.g-wSom.nt),wSom.g-wSom.nt<0?"negatief":"pos"]].forEach(function(c){
        var t=document.createElement("td"); t.className="num"+(c[1]?" "+c[1]:""); t.textContent=c[0]; tr.appendChild(t);
      });
      body.appendChild(tr);
    }

    var c=new Date(p.van.getFullYear(),p.van.getMonth(),p.van.getDate());
    while(c<=p.tot){
      var k=sleutel(c),d=haalDag(k),w=isoWeek(c);
      if(wk!==null&&w!==wk){ weekrij(); wSom={g:0,n:0,nt:0}; }
      wk=w; wNr=w;

      var netto=nettoMin(d,nu),norm=normVan(k,d),credit=creditVan(k,d,nu),verstreken=teltMee(k);
      wSom.g+=credit; wSom.n+=norm; if(verstreken) wSom.nt+=norm;

      var tr=document.createElement("tr");
      tr.className="dag"+((c.getDay()===0||c.getDay()===6)?" weekend":"")+(k===vandaagK?" vandaag":"");
      tr.tabIndex=0; tr.dataset.k=k;

      var tdD=document.createElement("td"); tdD.className="datum";
      tdD.appendChild(document.createTextNode(pad(c.getDate())+"/"+pad(c.getMonth()+1)));
      var dn=document.createElement("span"); dn.className="dagnaam"; dn.textContent=DAGNAMEN[c.getDay()];
      tdD.appendChild(dn); tr.appendChild(tdD);

      var tdT=document.createElement("td");
      if(heeftInhoud(d)||d.type!=="gewerkt"){
        var chip=document.createElement("span"); chip.className="chip "+TYPES[d.type].klasse;
        chip.textContent=TYPES[d.type].label; tdT.appendChild(chip);
      }
      tr.appendChild(tdT);

      var tdP=document.createElement("td"); tdP.className="tijden";
      var stukken=(d.blokken||[]).map(function(b){ return b.start+"–"+(b.eind||"…"); });
      tdP.textContent = stukken.length ? stukken.join("  ") : (d.notitie||feestNaam(k)||"");
      if(stukken.length&&d.notitie) tdP.title=d.notitie;
      tr.appendChild(tdP);

      (function(){
        function num(t,kl){ var td=document.createElement("td"); td.className="num"+(kl?" "+kl:""); td.textContent=t; tr.appendChild(td); }
        num((d.blokken&&d.blokken.length)?effPauze(d,nu)+"′":"","k-pauze");
        num(netto>0?uren(netto):"");
        num(norm>0?uren(norm):"","k-norm");
        var saldo=credit-norm;
        num((verstreken&&(credit||norm))?uren(saldo):"",saldo<0?"negatief":"pos");
      })();

      body.appendChild(tr);
      c.setDate(c.getDate()+1);
    }
    weekrij();
  }

  function tekenJaar(){
    var j=anker.getFullYear(),nu=Date.now();
    var tel={verlof:0,ziekte:0,vov:0,recup:0,feestdag:0,gewerkt:0};
    var g=0,nt=0;
    var c=new Date(j,0,1),eind=new Date(j,11,31);
    while(c<=eind){
      var k=sleutel(c),d=haalDag(k),norm=normVan(k,d);
      g+=creditVan(k,d,nu); if(teltMee(k)) nt+=norm;
      if(d.type==="feestdag"){ if(c.getDay()!==0&&c.getDay()!==6) tel.feestdag++; }
      else if(d.type!=="gewerkt"&&tel.hasOwnProperty(d.type)) tel[d.type]++;
      if(nettoMin(d,nu)>0) tel.gewerkt++;
      c.setDate(c.getDate()+1);
    }
    document.getElementById("jaarTitel").textContent=j;
    var js=document.getElementById("jaarSaldo");
    js.textContent=startK?("saldo "+uren(g-nt)):"nog geen registraties";
    js.className="saldo"+(startK?(g-nt<0?" negatief":" pos"):"");

    var box=document.getElementById("tellers"); box.innerHTML="";
    [[tel.gewerkt,"gewerkte dagen"],[uren(g),"gepresteerd"],[tel.verlof,"verlofdagen"],
     [tel.ziekte,"ziektedagen"],[tel.vov,"opleidingsverlof"],[tel.recup,"recupdagen"],
     [tel.feestdag,"feestdagen"]].forEach(function(r){
      var el=document.createElement("div"); el.className="teller";
      var v=document.createElement("span"); v.className="t-val"; v.textContent=r[0];
      var l=document.createElement("span"); l.className="t-lab"; l.textContent=r[1];
      el.appendChild(v); el.appendChild(l); box.appendChild(el);
    });
  }

  function tekenAlles(){ bepaalStart(); tekenKlok(); tekenStand(); tekenBlad(); tekenJaar(); zetSync(syncStand,syncFout); }

  /* ---------------- acties ---------------- */
  function nuHhmm(){ var n=new Date(); return pad(n.getHours())+":"+pad(n.getMinutes()); }
  function dagVoorSchrijven(k){
    if(!bestaat(k)) dagen[k]=leegDag(k);
    return dagen[k];
  }
  function klokKnop(){
    var d=dagVoorSchrijven(vandaagK),lb=loopendBlok(d);
    if(lb){
      lb.eind=nuHhmm(); lb.startTs=null;
      if(naarMin(lb.eind)===naarMin(lb.start)) lb.eind=naarHhmm(naarMin(lb.start)+1);
    }else{
      d.blokken.push({start:nuHhmm(),eind:null,startTs:Date.now()});
      if(d.type!=="gewerkt"&&!feestNaam(vandaagK)) d.type="gewerkt";
    }
    bewaarDag(vandaagK);
  }

  var overlay=document.getElementById("overlay");
  var bewerkK=null,concept=null,huidigeKaart=null;
  function sluit(){ overlay.hidden=true; bewerkK=null; concept=null; huidigeKaart=null; }
  overlay.addEventListener("click",function(e){ if(e.target===overlay) sluit(); });
  document.addEventListener("keydown",function(e){ if(e.key==="Escape"&&!overlay.hidden) sluit(); });

  function kaartVoet(links,knoppen){
    var voet=document.createElement("div"); voet.className="kaartvoet";
    voet.appendChild(links||document.createElement("span"));
    var r=document.createElement("div"); r.style.display="flex"; r.style.gap="8px"; r.style.flexWrap="wrap";
    knoppen.forEach(function(b){ r.appendChild(b); });
    voet.appendChild(r); return voet;
  }
  function knop(tekst,klasse,fn){
    var b=document.createElement("button"); b.type="button"; if(klasse) b.className=klasse;
    b.textContent=tekst; b.addEventListener("click",fn); return b;
  }
  function veldInvoer(id,label,type,waarde,extra){
    var v=document.createElement("div"); v.className="veld";
    var l=document.createElement("label"); l.setAttribute("for",id); l.textContent=label; v.appendChild(l);
    var i=document.createElement("input"); i.id=id; i.type=type; i.value=waarde==null?"":waarde;
    if(extra) Object.keys(extra).forEach(function(a){ i.setAttribute(a,extra[a]); });
    v.appendChild(i); return {wrap:v,input:i};
  }

  /* ---- dag bewerken ---- */
  function openDag(k){
    huidigeKaart="dag"; bewerkK=k; concept=JSON.parse(JSON.stringify(haalDag(k)));
    var dt=uitSleutel(k);
    document.getElementById("kaartTitel").textContent=
      DAGNAMEN[dt.getDay()]+" "+dt.getDate()+" "+MAANDEN[dt.getMonth()]+" "+dt.getFullYear()+
      (feestNaam(k)?" · "+feestNaam(k):"");
    tekenKaart(); overlay.hidden=false;
    var f=document.querySelector("#kaartInhoud .snel button"); if(f) f.focus();
  }
  function tekenKaart(){
    var wrap=document.getElementById("kaartInhoud"); wrap.innerHTML="";

    var vSnel=document.createElement("div"); vSnel.className="veld";
    var lSnel=document.createElement("label"); lSnel.textContent="Snel invullen"; vSnel.appendChild(lSnel);
    var snel=document.createElement("div"); snel.className="snel";
    [["Standaarddag",function(){
        concept.type="gewerkt"; concept.pauzeModus="auto";
        concept.blokken=[{start:instellingen.standaardBegin,eind:instellingen.standaardEinde,startTs:null}];
      }],
     ["Verlof",function(){ concept.type="verlof"; concept.blokken=[]; }],
     ["Ziekte",function(){ concept.type="ziekte"; concept.blokken=[]; }],
     ["Opleidingsverlof",function(){ concept.type="vov"; concept.blokken=[]; }],
     ["Recup",function(){ concept.type="recup"; concept.blokken=[]; }]
    ].forEach(function(o){ snel.appendChild(knop(o[0],null,function(){ o[1](); tekenKaart(); })); });
    vSnel.appendChild(snel); wrap.appendChild(vSnel);

    var vType=document.createElement("div"); vType.className="veld";
    var lT=document.createElement("label"); lT.setAttribute("for","fType"); lT.textContent="Type dag"; vType.appendChild(lT);
    var sel=document.createElement("select"); sel.id="fType";
    Object.keys(TYPES).forEach(function(t){
      var o=document.createElement("option"); o.value=t; o.textContent=TYPES[t].label;
      if(concept.type===t) o.selected=true; sel.appendChild(o);
    });
    sel.addEventListener("change",function(){ concept.type=sel.value; });
    vType.appendChild(sel); wrap.appendChild(vType);

    var vBlok=document.createElement("div"); vBlok.className="veld";
    var lB=document.createElement("label"); lB.textContent="Prestaties"; vBlok.appendChild(lB);
    (concept.blokken||[]).forEach(function(b,idx){
      var rij=document.createElement("div"); rij.className="blokrij";
      var i1=document.createElement("input"); i1.type="time"; i1.value=b.start||""; i1.setAttribute("aria-label","Begin");
      var sp=document.createElement("span"); sp.textContent="–";
      var i2=document.createElement("input"); i2.type="time"; i2.value=b.eind||""; i2.setAttribute("aria-label","Einde");
      i1.addEventListener("input",function(){ b.start=i1.value; b.startTs=null; });
      i2.addEventListener("input",function(){ b.eind=i2.value||null; b.startTs=null; });
      var vw=knop("✕","stil",function(){ concept.blokken.splice(idx,1); tekenKaart(); });
      vw.setAttribute("aria-label","Prestatie verwijderen");
      rij.appendChild(i1); rij.appendChild(sp); rij.appendChild(i2); rij.appendChild(vw);
      vBlok.appendChild(rij);
    });
    vBlok.appendChild(knop("+ Prestatie",null,function(){
      concept.blokken=concept.blokken||[];
      var l=concept.blokken[concept.blokken.length-1];
      concept.blokken.push({start:(l&&l.eind)?l.eind:instellingen.standaardBegin,eind:null,startTs:null});
      tekenKaart();
    }));
    wrap.appendChild(vBlok);

    var duo=document.createElement("div"); duo.className="duo";
    var vP=document.createElement("div"); vP.className="veld";
    var lP=document.createElement("label"); lP.setAttribute("for","fPauzeM"); lP.textContent="Pauze"; vP.appendChild(lP);
    var spm=document.createElement("select"); spm.id="fPauzeM";
    [["auto","Automatisch ("+instellingen.standaardPauze+" min vanaf 6 u)"],
     ["geen","Geen — doorgewerkt"],
     ["handmatig","Zelf ingeven"]].forEach(function(o){
      var e=document.createElement("option"); e.value=o[0]; e.textContent=o[1];
      if((concept.pauzeModus||"auto")===o[0]) e.selected=true; spm.appendChild(e);
    });
    var ip=document.createElement("input"); ip.type="number"; ip.min="0"; ip.step="5";
    ip.value=concept.pauze||0; ip.setAttribute("aria-label","Pauze in minuten");
    ip.hidden=(concept.pauzeModus||"auto")!=="handmatig";
    ip.addEventListener("input",function(){ concept.pauze=Math.max(0,+ip.value||0); });
    spm.addEventListener("change",function(){ concept.pauzeModus=spm.value; ip.hidden=spm.value!=="handmatig"; });
    vP.appendChild(spm); vP.appendChild(ip);

    var vN=veldInvoer("fNot","Notitie","text",concept.notitie||"");
    vN.input.addEventListener("input",function(){ concept.notitie=vN.input.value; });
    duo.appendChild(vP); duo.appendChild(vN.wrap); wrap.appendChild(duo);

    wrap.appendChild(kaartVoet(
      knop("Dag wissen","gevaar",function(){ var k=bewerkK; if(dagen[k]) dagen[k].verwijderd=true; sluit(); bewaarDag(k); }),
      [knop("Annuleren","stil",sluit),
       knop("Opslaan","opslaan",function(){
         concept.blokken=(concept.blokken||[]).filter(function(b){ return b.start; });
         var k=bewerkK; dagen[k]=concept; sluit(); bewaarDag(k);
       })]
    ));
  }

  /* ---- instellingen ---- */
  function openInstellingen(){
    huidigeKaart="instel";
    document.getElementById("kaartTitel").textContent="Instellingen";
    var wrap=document.getElementById("kaartInhoud"); wrap.innerHTML="";

    var d1=document.createElement("div"); d1.className="duo";
    var fU=veldInvoer("fUren","Uren per week","number",instellingen.urenPerWeek,{min:"1",max:"60",step:"0.5"});
    var fP=veldInvoer("fStdP","Standaardpauze (min)","number",instellingen.standaardPauze,{min:"0",step:"5"});
    d1.appendChild(fU.wrap); d1.appendChild(fP.wrap); wrap.appendChild(d1);

    var d2=document.createElement("div"); d2.className="duo";
    var fB=veldInvoer("fBegin","Standaarddag van","time",instellingen.standaardBegin);
    var fE=veldInvoer("fEinde","tot","time",instellingen.standaardEinde);
    d2.appendChild(fB.wrap); d2.appendChild(fE.wrap); wrap.appendChild(d2);

    var u=document.createElement("p"); u.className="hint";
    u.textContent="De dagnorm is uren per week gedeeld door vijf, van maandag tot vrijdag, behalve op Belgische feestdagen. "+
      "De standaardpauze gaat er automatisch af zodra je op één dag meer dan zes uur klokt — met de pauzeknop of via Dag bewerken zet je die aftrek per dag uit.";
    wrap.appendChild(u);

    wrap.appendChild(kaartVoet(null,[
      knop("Annuleren","stil",sluit),
      knop("Opslaan","opslaan",function(){
        instellingen.urenPerWeek=Math.min(60,Math.max(1,+fU.input.value||40));
        instellingen.standaardPauze=Math.max(0,+fP.input.value||0);
        if(fB.input.value) instellingen.standaardBegin=fB.input.value;
        if(fE.input.value) instellingen.standaardEinde=fE.input.value;
        sluit(); bewaarInstellingen();
      })
    ]));
    overlay.hidden=false;
  }

  /* ---- synchronisatie-scherm ---- */
  function openAccount(){
    huidigeKaart="account";
    document.getElementById("kaartTitel").textContent="Synchronisatie";
    var wrap=document.getElementById("kaartInhoud"); wrap.innerHTML="";
    var c=config();

    if(!c.url||!c.anonKey){
      var p=document.createElement("p"); p.className="hint";
      p.textContent="Je uren staan nu enkel op dit toestel. Vul de twee gegevens van je Supabase-project in "+
        "(Project Settings → API) om ze tussen je gsm en je pc gelijk te houden. Je kan ze ook vast in config.js zetten.";
      wrap.appendChild(p);
      var fU=veldInvoer("fSbUrl","Project-URL","url",c.url,{placeholder:"https://xxxx.supabase.co"});
      var fK=veldInvoer("fSbKey","Anon public key","text",c.anonKey,{placeholder:"eyJhbGciOi…"});
      wrap.appendChild(fU.wrap); wrap.appendChild(fK.wrap);
      wrap.appendChild(kaartVoet(null,[
        knop("Annuleren","stil",sluit),
        knop("Bewaren","opslaan",function(){
          var u=fU.input.value.trim().replace(/\/+$/,""), k=fK.input.value.trim();
          if(!u||!k){ melding("Vul beide velden in."); return; }
          try{ localStorage.setItem(LS_C,JSON.stringify({url:u,anonKey:k})); }catch(e){}
          sluit(); startSync().then(function(){ openAccount(); });
        })
      ]));
      overlay.hidden=false; return;
    }

    if(!zorgVoorClient()){
      var pb=document.createElement("p"); pb.className="foutlijn";
      pb.textContent = bibliotheekAanwezig()
        ? "De verbinding met Supabase kon niet opgezet worden. Controleer of de project-URL klopt en met https:// begint."
        : "Het bestand vendor/supabase.js is niet geladen. Meestal betekent dit dat de map vendor niet mee geüpload is; "+
          "voeg die alsnog toe naast index.html en herlaad de pagina.";
      wrap.appendChild(pb);
      var pu=document.createElement("p"); pu.className="hint";
      pu.textContent="Je uren blijven ondertussen gewoon op dit toestel bewaard — er gaat niets verloren.";
      wrap.appendChild(pu);
      wrap.appendChild(kaartVoet(
        knop("Andere server","stil",function(){
          try{ localStorage.removeItem(LS_C); }catch(e){}
          SB=null; sessie=null; zetSync("uit"); openAccount();
        }),
        [knop("Sluiten","stil",sluit),
         knop("Opnieuw proberen","opslaan",function(){ sluit(); startSync().then(function(){ openAccount(); }); })]
      ));
      overlay.hidden=false; return;
    }

    if(!sessie){
      var p2=document.createElement("p"); p2.className="hint";
      p2.textContent="Meld je aan met hetzelfde adres op je gsm en je pc; dan lopen je uren gelijk.";
      wrap.appendChild(p2);
      var fE=veldInvoer("fMail","E-mailadres","email","",{autocomplete:"username"});
      var fW=veldInvoer("fWw","Wachtwoord","password","",{autocomplete:"current-password"});
      wrap.appendChild(fE.wrap); wrap.appendChild(fW.wrap);
      var fout=document.createElement("p"); fout.className="foutlijn"; fout.hidden=true; wrap.appendChild(fout);

      async function poging(nieuw){
        fout.hidden=true;
        if(!zorgVoorClient()){
          fout.className="foutlijn";
          fout.textContent="Synchronisatie is nog niet klaar. Sluit dit venster en probeer opnieuw.";
          fout.hidden=false; return;
        }
        var mail=fE.input.value.trim(), ww=fW.input.value;
        if(!mail||!ww){ fout.textContent="Vul je e-mailadres en wachtwoord in."; fout.hidden=false; return; }
        try{
          var r = nieuw ? await SB.auth.signUp({email:mail,password:ww})
                        : await SB.auth.signInWithPassword({email:mail,password:ww});
          if(r.error) throw r.error;
          if(nieuw && r.data && r.data.user && !r.data.session){
            fout.className="goedlijn";
            fout.textContent="Account aangemaakt. Bevestig eerst de e-mail die Supabase je stuurde, en meld je daarna aan.";
            fout.hidden=false; return;
          }
          sessie=(r.data&&r.data.session)||null;
          sluit(); await synchroniseer();
        }catch(e){
          fout.className="foutlijn";
          fout.textContent=inHetNederlands(e);
          fout.hidden=false;
        }
      }
      fW.input.addEventListener("keydown",function(e){ if(e.key==="Enter") poging(false); });
      wrap.appendChild(kaartVoet(
        knop("Andere server","stil",function(){
          try{ localStorage.removeItem(LS_C); }catch(e){}
          SB=null; sessie=null; zetSync("uit"); openAccount();
        }),
        [knop("Account aanmaken",null,function(){ poging(true); }),
         knop("Aanmelden","opslaan",function(){ poging(false); })]
      ));
      overlay.hidden=false; return;
    }

    var info=document.createElement("p"); info.className="hint";
    var n=aantalVuil();
    info.textContent="Aangemeld als "+(sessie.user&&sessie.user.email||"onbekend")+". "+
      (n? (n+" wijziging"+(n===1?"":"en")+" wacht nog op verzending.")
        : (laatsteSync? ("Laatst gesynchroniseerd om "+pad(laatsteSync.getHours())+":"+pad(laatsteSync.getMinutes())+".")
                      : "Nog niet gesynchroniseerd deze sessie."));
    wrap.appendChild(info);
    if(syncStand==="fout"&&syncFout){
      var f=document.createElement("p"); f.className="foutlijn"; f.textContent="Laatste fout: "+syncFout; wrap.appendChild(f);
    }
    wrap.appendChild(kaartVoet(
      knop("Afmelden","gevaar",async function(){
        try{ await SB.auth.signOut(); }catch(e){}
        sessie=null; sluit(); zetSync("aanmelden");
      }),
      [knop("Sluiten","stil",sluit),
       knop("Nu synchroniseren","opslaan",async function(){ sluit(); await synchroniseer(); melding(syncStand==="ok"?"Bijgewerkt.":"Synchroniseren mislukt."); })]
    ));
    overlay.hidden=false;
  }

  /* ---------------- export ---------------- */
  function bouwCsv(){
    var p=periode(),nu=Date.now();
    var r=["Datum;Dag;Week;Type;Prestaties;Pauze (min);Netto (u);Norm (u);Saldo (u);Notitie"];
    var tg=0,tn=0;
    var c=new Date(p.van.getFullYear(),p.van.getMonth(),p.van.getDate());
    while(c<=p.tot){
      var k=sleutel(c),d=haalDag(k),norm=normVan(k,d),credit=creditVan(k,d,nu),verstreken=teltMee(k);
      tg+=credit; if(verstreken) tn+=norm;
      r.push([
        pad(c.getDate())+"/"+pad(c.getMonth()+1)+"/"+c.getFullYear(),
        DAGNAMEN[c.getDay()], isoWeek(c),
        (heeftInhoud(d)||d.type!=="gewerkt")?TYPES[d.type].label:"",
        (d.blokken||[]).map(function(b){ return b.start+"-"+(b.eind||""); }).join(" "),
        effPauze(d,nu), urenDec(nettoMin(d,nu)), urenDec(norm),
        verstreken?urenDec(credit-norm):"",
        (d.notitie||"").replace(/[;\r\n]/g," ")
      ].join(";"));
      c.setDate(c.getDate()+1);
    }
    r.push(["TOTAAL","","","","","",urenDec(tg),urenDec(tn),urenDec(tg-tn),""].join(";"));
    return "﻿"+r.join("\r\n");
  }
  function bestandsnaam(){
    if(weergave==="week"){ var ma=maandagVan(anker); return "tikklok-"+ma.getFullYear()+"-W"+pad(isoWeek(ma))+".csv"; }
    return "tikklok-"+anker.getFullYear()+"-"+pad(anker.getMonth()+1)+".csv";
  }
  function exporteer(){
    var csv=bouwCsv();
    try{
      var blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
      var url=URL.createObjectURL(blob);
      var a=document.createElement("a"); a.href=url; a.download=bestandsnaam();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); },2000);
      melding("CSV gedownload.");
    }catch(e){ toonCsvTekst(csv); }
  }
  function toonCsvTekst(csv){
    huidigeKaart="csv";
    document.getElementById("kaartTitel").textContent="CSV kopiëren";
    var wrap=document.getElementById("kaartInhoud"); wrap.innerHTML="";
    var p=document.createElement("p"); p.className="hint";
    p.textContent="Selecteer alles en plak in Excel. Kolommen gescheiden met puntkomma, decimalen met komma.";
    var ta=document.createElement("textarea");
    ta.style.minHeight="220px"; ta.style.fontFamily="var(--f-mono)"; ta.style.fontSize=".8rem";
    ta.value=csv.replace("﻿","");
    wrap.appendChild(p); wrap.appendChild(ta);
    wrap.appendChild(kaartVoet(null,[knop("Sluiten","opslaan",sluit)]));
    overlay.hidden=false; ta.select();
  }

  /* ---------------- koppelen ---------------- */
  function verzet(n){
    if(weergave==="week") anker=plusDagen(maandagVan(anker),n*7);
    else anker=new Date(anker.getFullYear(),anker.getMonth()+n,1);
    tekenAlles();
  }
  document.getElementById("btnKlok").addEventListener("click",klokKnop);
  document.getElementById("btnVandaag").addEventListener("click",function(){ openDag(vandaagK); });
  document.getElementById("btnPauze").addEventListener("click",function(){
    var d=dagVoorSchrijven(vandaagK);
    d.pauzeModus=(d.pauzeModus==="geen")?"auto":"geen";
    bewaarDag(vandaagK);
  });
  document.getElementById("btnInstel").addEventListener("click",openInstellingen);
  document.getElementById("btnAccount").addEventListener("click",openAccount);
  document.getElementById("btnExport").addEventListener("click",exporteer);
  document.getElementById("btnWeek").addEventListener("click",function(){ weergave="week"; tekenAlles(); });
  document.getElementById("btnMaand").addEventListener("click",function(){ weergave="maand"; tekenAlles(); });
  document.getElementById("btnVorige").addEventListener("click",function(){ verzet(-1); });
  document.getElementById("btnVolgende").addEventListener("click",function(){ verzet(1); });
  document.getElementById("btnNu").addEventListener("click",function(){ anker=new Date(); tekenAlles(); });
  document.getElementById("tabelBody").addEventListener("click",function(e){
    var tr=e.target.closest("tr.dag"); if(tr) openDag(tr.dataset.k);
  });
  document.getElementById("tabelBody").addEventListener("keydown",function(e){
    if(e.key!=="Enter"&&e.key!==" ") return;
    var tr=e.target.closest("tr.dag"); if(tr){ e.preventDefault(); openDag(tr.dataset.k); }
  });

  window.addEventListener("online",function(){ synchroniseer(true); });
  window.addEventListener("offline",function(){ if(sessie) zetSync("fout"); });
  document.addEventListener("visibilitychange",function(){
    if(document.visibilityState==="visible"){
      var n=sleutel(new Date());
      if(n!==vandaagK){ vandaagK=n; }
      tekenAlles(); synchroniseer(true);
    }
  });

  /* ---------------- start ---------------- */
  lokaalLees();
  tekenAlles();
  setInterval(function(){
    var n=sleutel(new Date());
    if(n!==vandaagK){ vandaagK=n; tekenAlles(); } else tekenKlok();
  },1000);
  setInterval(function(){ synchroniseer(true); },90000);
  startSync();

  if("serviceWorker" in navigator){
    window.addEventListener("load",function(){
      navigator.serviceWorker.register("sw.js").catch(function(){});
    });
  }
})();
