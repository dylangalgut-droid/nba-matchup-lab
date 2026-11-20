'use strict';
const fs=require('node:fs'),path=require('node:path');
const {buildAnalysis,normTeam}=require('./analysis');
const {defaultModel}=require('./model');
const ZONES=[['rim','Restricted area (approx.)'],['paint','Other paint'],['mid','Mid-range'],['corner','Corner threes'],['arc','Above-the-break threes']];
const empty=()=>Object.fromEntries(ZONES.map(([z])=>[z,{a:0,p:0,m:0}]));
function zone(p){
 const x=p.coordinate?.x,y=p.coordinate?.y,v=p.pointsAttempted;
 if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>50||y< -5.25||y>89||![2,3].includes(v))return null;
 if(v===3)return Math.abs(x-25)>=22&&y<=9?'corner':'arc';
 if(Math.hypot(x-25,y)<=4)return 'rim';
 return Math.abs(x-25)<=8&&y<=13.75?'paint':'mid';
}
function parse(summary,g){
 const teams=Object.fromEntries((summary.header?.competitions?.[0]?.competitors||[]).map(c=>[c.team.id,normTeam(c.team.abbreviation)]));
 const shots=[],seen=new Set();
 for(const p of summary.plays||[]){
  if(!p.shootingPlay||![2,3].includes(p.pointsAttempted)||seen.has(p.id))continue;
  seen.add(p.id);const z=zone(p),team=teams[p.team?.id],id=String(p.participants?.[0]?.athlete?.id||'');
  if(!z||!id||![g.home,g.away].includes(team))throw Error('Unlocated or unidentified field-goal attempt');
  if(![0,p.pointsAttempted].includes(p.scoreValue))throw Error('Inconsistent shot points');
  shots.push({id,team,z,p:p.scoreValue,m:p.scoreValue>0?1:0,heave:String(p.type?.id)==='282'});
 }
 if(!shots.length)throw Error('No shot locations');
 const boxes=[];
 for(const side of summary.boxscore?.players||[])for(const batch of side.statistics||[]){
  const idx=k=>batch.labels.indexOf(k);
  for(const a of batch.athletes||[]){if(a.didNotPlay)continue;
   const vals=a.stats||[],pair=k=>String(vals[idx(k)]||'').split('-').map(Number),[fgm,fga]=pair('FG'),[tpm,tpa]=pair('3PT');
   if(!Number.isFinite(fga)||!Number.isFinite(fgm)||!Number.isFinite(tpm))continue;
   const id=String(a.athlete.id),team=normTeam(side.team.abbreviation),ps=shots.filter(s=>s.id===id&&s.team===team);
   if(ps.length===fga)for(const shot of ps)shot.heave=false;
   if(ps.filter(s=>!s.heave).length!==fga||ps.reduce((n,s)=>n+s.m,0)!==fgm||ps.filter(s=>!s.heave&&['corner','arc'].includes(s.z)).length!==tpa||ps.filter(s=>['corner','arc'].includes(s.z)).reduce((n,s)=>n+s.m,0)!==tpm)throw Error('Shot totals do not reconcile with player box score');
   boxes.push({id,team,tpm});
  }
 }
 if(boxes.reduce((n,p)=>n+shots.filter(s=>s.id===p.id&&s.team===p.team).length,0)!==shots.length)throw Error('Unmatched shooter');
 return {id:g.id,date:g.date,home:g.home,away:g.away,shots,boxes};
}
function aggregate(games){
 const teams={},players={},league={games:0,z:empty()};
 const team=t=>teams[t]||(teams[t]={games:0,off:empty(),def:empty()});
 for(const g of games){league.games+=2;team(g.home).games++;team(g.away).games++;
  for(const p of g.boxes){const k=p.team+'|'+p.id;players[k]||={id:p.id,team:p.team,games:0,z:empty(),tpm:0};players[k].games++;players[k].tpm+=p.tpm;}
  for(const s of g.shots){const opp=s.team===g.home?g.away:g.home;for(const target of [team(s.team).off[s.z],team(opp).def[s.z],league.z[s.z],s.heave?null:players[s.team+'|'+s.id]?.z[s.z]])if(target){target.a++;target.p+=s.p;target.m+=s.m;}}
 }
 return {teams,players,league};
}
// Zone-specific efficiency residual removes the defence's broad efficiency effect.
// Uses the player's own attempts; does not reapply minutes, volume or injury boosts.
function adjustment(agg,id,team,opp){
 const p=agg.players[team+'|'+id],d=agg.teams[opp],l=agg.league;
 if(!p||!d||p.games<3||d.games<3)return {pts:0,tpm:0,drivers:[]};
 const total=z=>Object.values(z).reduce((r,x)=>({a:r.a+x.a,p:r.p+x.p}),{a:0,p:0});
 const dt=total(d.def),lt=total(l.z),broad=dt.p/Math.max(1,dt.a)-lt.p/Math.max(1,lt.a);
 const drivers=ZONES.map(([z,name])=>{const a=p.z[z],b=d.def[z],c=l.z[z];
  const residual=b.a&&c.a?(b.p/b.a-c.p/c.a-broad):0;
  const pts=(a.a/p.games)*Math.max(-.3,Math.min(.3,residual))*(b.a/(b.a+150))*(a.a/(a.a+30))*.35;
  return {zone:z,name,pts,tpm:['corner','arc'].includes(z)?pts/3:0};
 });
 const rawPts=drivers.reduce((n,d)=>n+d.pts,0),rawThrees=drivers.reduce((n,d)=>n+d.tpm,0);
 const scale=Math.min(1,1.5/Math.max(.0001,Math.abs(rawPts)),.35/Math.max(.0001,Math.abs(rawThrees)));
 for(const d of drivers){d.pts*=scale;d.tpm*=scale;}
 const pts=rawPts*scale,tpm=rawThrees*scale;
 return {pts,tpm,drivers};
}
function applyShotProjection(p,adj,threesBaseline=null){
 const x=p.stats.pts;
 const baseline=x.beforeShots??x.projection;
 x.beforeShots=baseline;
 x.projection=Math.round(Math.max(0,baseline+adj.pts)*100)/100;
 x.delta=Math.round((x.projection-x.base)*100)/100;
 x.edge=x.totalEdge=Math.round(1000*x.delta/Math.max(1,x.base))/10;
 x.level=x.limited?'limited':Math.abs(x.delta)<1.5?'neutral':x.edge>=17?'strong-positive':x.edge>=10?'positive':x.edge<=-17?'strong-negative':x.edge<=-10?'negative':'neutral';
 x.components={...x.components,shots:Math.round(adj.pts*100)/100};
 p.shotCandidate={...adj,points:x.projection,pointsBaseline:baseline,threesBaseline,threes:threesBaseline===null?null:Math.max(0,threesBaseline+adj.tpm),enabled:true};
 p.major=['pts','reb','ast'].some(k=>['strong-positive','strong-negative'].includes(p.stats[k].level));
 p.maxEdge=Math.max(...['pts','reb','ast'].map(k=>Math.abs(p.stats[k].edge)));
 return ['pts','reb','ast'].some(k=>['positive','negative','strong-positive','strong-negative'].includes(p.stats[k].level));
}
function audit(all,shotGames){
 const valid=new Map(shotGames.map(g=>[g.id,g]));const dates=[...new Set(all.map(g=>g.date.slice(0,10)))].sort();let rows=[];
 for(const date of dates){
  const past=all.filter(g=>g.date.slice(0,10)<date),actual=all.filter(g=>g.date.slice(0,10)===date&&valid.has(g.id));
  if(past.length<40||!actual.length)continue;
  const agg=aggregate(shotGames.filter(g=>g.date.slice(0,10)<date));
  const scan=buildAnalysis(past,actual.map(g=>({...g,completed:false})),{available:false,records:[]},{includeNeutral:true,model:defaultModel(),asOf:date+'T00:00:00Z'});
  for(const g of scan.matches)for(const p of g.players){const a=actual.find(x=>x.id===g.id).players.find(x=>String(x.id)===p.id&&x.team===p.team),sp=agg.players[p.team+'|'+p.id],box=valid.get(g.id).boxes.find(x=>x.id===p.id&&x.team===p.team);if(!a||a.min<6||!sp||sp.games<5||!box)continue;
   const opp=p.team===g.home?g.away:g.home;if((agg.teams[opp]?.games||0)<5)continue;
   const adj=adjustment(agg,p.id,p.team,opp);rows.push({date,pts:{base:p.stats.pts.projection,next:Math.max(0,p.stats.pts.projection+adj.pts),actual:a.pts},tpm:{base:sp.tpm/sp.games,next:Math.max(0,sp.tpm/sp.games+adj.tpm),actual:box.tpm}});
  }
 }
 const ds=[...new Set(rows.map(r=>r.date))],start=ds[Math.floor(ds.length*.7)],holdout=rows.filter(r=>r.date>=start);
 const metrics=Object.fromEntries(['pts','tpm'].map(k=>{const n=holdout.length,mae=n?holdout.reduce((s,r)=>s+Math.abs(r[k].base-r[k].actual),0)/n:null,next=n?holdout.reduce((s,r)=>s+Math.abs(r[k].next-r[k].actual),0)/n:null;return [k,{n,baselineMAE:mae,shotMAE:next,improvement:mae==null?null:mae-next}];}));
 // Descriptive and candidate only: historical injury snapshots and the original
 // deployed coefficient versions do not exist. Do not claim a full live-model test.
 return {metrics,totalRows:rows.length,first:holdout[0]?.date,last:holdout.at(-1)?.date,enabled:true,reason:'Shot adjustments enabled by user request despite slightly worse initial held-out errors. Walk-forward comparison reconstructs the current model with frozen default coefficients and no historical injury reports; it cannot reproduce historical deployed predictions. Made-threes baseline is prior player average (the existing model had no made-threes forecast). Live points and made-threes projections include the modest shot adjustment.',method:'Last 30% of eligible dates held out; every feature uses earlier calendar dates only. Same player-games for both variants; minimum five prior player and opponent shot games. No tuning on these results.'};
}
async function build(cache,dashboard,{cached=false}={}){
 const file=path.join(__dirname,'data/shots.json');let archive;try{archive=JSON.parse(fs.readFileSync(file));}catch{archive={games:{}};}
 const all=Object.values(cache.games).filter(g=>g.completed&&g.seasonType===2&&g.date>=dashboard.sample.first).sort((a,b)=>a.date.localeCompare(b.date));
 const needed=all.filter(g=>!archive.games[g.id]);const failures=[];let at=0;
 if(!cached)await Promise.all(Array.from({length:5},async()=>{while(at<needed.length){const g=needed[at++];try{const r=await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='+g.id,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('HTTP '+r.status);archive.games[g.id]=parse(await r.json(),g);}catch(e){failures.push({id:g.id,error:e.message});}if(at%25===0){fs.writeFileSync(file,JSON.stringify(archive));console.log('Shot imports',at,'/',needed.length);}}}));
 fs.writeFileSync(file,JSON.stringify(archive));
 const ids=new Set(all.map(g=>g.id)),games=Object.values(archive.games).filter(g=>ids.has(g.id)),agg=aggregate(games),report=audit(all,games);
 const names=new Map();for(const g of all)for(const p of g.players)names.set(String(p.id),p);
 for(const p of Object.values(agg.players)){const n=names.get(p.id);p.name=n?.name||p.id;p.currentTeam=n?.team;p.injury=(cache.injuries?.records||[]).find(i=>String(i.id)===p.id)?.status||null;}
 for(const g of dashboard.matches){
  g.players=g.players.filter(p=>{const opp=p.team===g.home?g.away:g.home,adj=adjustment(agg,p.id,p.team,opp),sp=agg.players[p.team+'|'+p.id];return applyShotProjection(p,adj,sp?sp.tpm/sp.games:null);});
  g.players.sort((a,b)=>Number(b.major)-Number(a.major)||b.maxEdge-a.maxEdge);
 }
 dashboard.highlights=dashboard.matches.flatMap(g=>g.players.map(p=>({...p,opponent:p.team===g.home?g.away:g.home,eventId:g.id,gameDate:g.date}))).sort((a,b)=>Number(b.major)-Number(a.major)||b.maxEdge-a.maxEdge);
 dashboard.methodology.shots='Shot tendencies adjust points and made threes once, with sample shrinkage and caps of ±1.5 points / ±0.35 threes. Enabled by request; the initial paired backtest was slightly worse.';

 return {zones:ZONES,...agg,audit:report,coverage:{expected:all.length,imported:games.length,excluded:all.length-games.length,failures:failures.slice(0,15)},lastUpdated:dashboard.lastUpdated,fixtures:dashboard.matches.map(({id,date,home,away,completed})=>({id,date,home,away,completed})),source:'ESPN public play-by-play and reconciled box scores',notes:'Locations are rounded ESPN coordinates: hoop (25,0), restricted radius ≤4 ft, other paint |x−25|≤8 and y≤13.75, corner three |x−25|≥22 and y≤9; remaining two/three-point shots go to mid-range/above-break. Zones are mutually exclusive location estimates, not official tracking classifications. Free throws excluded. Recorded heaves excluded from player box-score attempts remain in team zone totals but not player attempts. Only games whose attempts, makes and threes reconcile to every player box score are included. Play types unavailable.'};
}
module.exports={ZONES,zone,parse,aggregate,adjustment,applyShotProjection,audit,build};
