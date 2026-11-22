'use strict';
// No npm installs, API keys or framework required. Node.js >=20.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {buildAnalysis,localDate,addDays,dateRange,dateKey,normTeam,TEAMS}=require('./analysis');
const {createBacktest}=require('./backtest');
const {defaultModel}=require('./model');
const storage=require('./storage');
const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ROOT=__dirname;
const CACHE_FILE=path.join(process.env.DATA_DIR||path.join(ROOT,'.data'),'cache.json');
const BACKTEST_FILE=path.join(process.env.DATA_DIR||path.join(ROOT,'.data'),'backtest.json');
const PUBLIC=path.join(ROOT,'public');
const PORT=Number(process.env.PORT||3000);
const HOST=process.env.HOST || (process.env.RAILWAY_ENVIRONMENT?'0.0.0.0':'127.0.0.1');
const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'';
const PROTECTED=!!ADMIN_TOKEN || !!process.env.RAILWAY_ENVIRONMENT || HOST==='0.0.0.0';
const eqSecret=(a,b)=>{const aa=Buffer.from(a||''),bb=Buffer.from(b||'');return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);};
function authorized(req){if(!PROTECTED)return true;const h=String(req.headers.authorization||'');return ADMIN_TOKEN.length>=24&&h.startsWith('Bearer ')&&eqSecret(h.slice(7),ADMIN_TOKEN);}

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const now=()=>new Date().toISOString();
let cache=readCache();
let dashboard=null,audit=null,job={running:false,phase:'idle',done:0,total:0,lastUpdated:cache.lastUpdated||null,error:null,warnings:[],completed:0,coverage:null};
function coverage(){
  const start=currentPeriod().start;
  const expected=new Map(Object.values(cache.scores||{}).flatMap(s=>s.events||[]).filter(g=>g.completed && g.date?.slice(0,10)>=start).map(g=>[g.id,g]));
  const missing=[...expected.values()].filter(g=>!Array.isArray(cache.games[g.id]?.players)||cache.games[g.id].players.length<5);
  return {expected:expected.size,imported:expected.size-missing.length,missing:missing.length,missingGames:missing.slice(0,25).map(g=>({id:g.id,description:g.description,date:g.date}))};
}
function readCache(){try{return JSON.parse(fs.readFileSync(CACHE_FILE,'utf8'));}catch{return {scores:{},games:{},injuries:{available:false,records:[]},lastUpdated:null};}}
async function persist(){await storage.save(cache,audit);}
function eventFromESPN(e){
  const comps=e?.competitions?.[0]?.competitors||[];
  const home=comps.find(x=>x.homeAway==='home')?.team;
  const away=comps.find(x=>x.homeAway==='away')?.team;
  const score=side=>{const v=comps.find(x=>x.homeAway===side)?.score;return v!==undefined&&v!==null&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;};
  return {id:String(e.id),date:e.date||e.competitions?.[0]?.date||'',home:normTeam(home?.abbreviation),away:normTeam(away?.abbreviation),completed:!!(e.status?.type?.completed||e.status?.type?.state==='post'),homeScore:score('home'),awayScore:score('away'),seasonType:e.season?.type??null,description:e.name||''};
}
function parseMinutes(v){
  if(typeof v==='number')return v;
  if(v==null||v==='--'||v==='-')return 0;
  if(/^\d+:\d+$/.test(String(v))){const [m,s]=String(v).split(':').map(Number);return m+s/60;}
  return Math.max(0,parseFloat(v)||0);
}
function statValue(s){
  if(typeof s==='number')return s;
  if(s && typeof s==='object')return statValue(s.value??s.displayValue??s.stat??0);
  const n=parseFloat(String(s??'0').replace(/,/g,''));return Number.isFinite(n)?n:0;
}
function attemptCount(value){const m=String(value??'').match(/^\s*\d+\s*-\s*(\d+)/);return m?Number(m[1]):null;}
function readStat(vals,labels,names){
  const idx=labels.findIndex(x=>names.includes(String(x).toUpperCase().replace(/[^A-Z0-9]/g,'')));
  return idx<0?null:vals[idx];
}
function extractBox(summary,event){
  const sections=summary?.boxscore?.players||[];
  const rows=[];
  for(const side of sections){
    const offense=normTeam(side.team?.abbreviation);
    if(!offense||!['home','away'].some(k=>event[k]===offense))continue;
    const opponent=offense===event.home?event.away:event.home;
    for(const batch of side.statistics||[]){
      const labels=(batch.labels||batch.keys||[]).map(x=>String(x).toUpperCase().replace(/[^A-Z0-9]/g,''));
      for(const a of batch.athletes||[]){
        if(a.didNotPlay===true||a.athlete?.didNotPlay===true)continue;
        const player=a.athlete||a;
        const vals=a.stats||a.statistics||[];
        if(!Array.isArray(vals))continue;
        const get=names=>statValue(readStat(vals,labels,names));
        const id=player.id;
        const min=parseMinutes(readStat(vals,labels,['MIN','MINUTES']));
        const pts=get(['PTS','POINTS']), reb=get(['REB','REBOUNDS','TREB']),ast=get(['AST','ASSISTS']);
        const three=readStat(vals,labels,['3PT','3PM3PA','3PM3PA3PCT']);
        const madeRaw=typeof three==='string'&&/^\d+-\d+$/.test(three.trim())?three.split('-')[0]:readStat(vals,labels,['3PM']);
        const tpm=madeRaw!==null&&madeRaw!==''&&Number.isInteger(Number(madeRaw))&&Number(madeRaw)>=0?Number(madeRaw):null;
        const threeAtt=typeof three==='string'&&three.includes('-')?statValue(three.split('-')[1]):get(['3PA']);
        const position=player.position?.abbreviation||player.position?.name||player.position||a.position?.abbreviation||null;
        const fg=attemptCount(readStat(vals,labels,['FG','FGM-FGA','FGMFGA']));
        const ft=attemptCount(readStat(vals,labels,['FT','FTM-FTA','FTMFTA']));
        const offRebounds=readStat(vals,labels,['OREB','OR','OFFREB']);
        const turnovers=readStat(vals,labels,['TO','TOV','TURNOVERS']);
        const hasPossessions=fg!==null&&ft!==null&&offRebounds!==null&&turnovers!==null;
        if(!id||min<1)continue;
        rows.push({id:String(id),name:player.displayName||player.fullName||player.name||'Unknown player',team:offense,opponent,position,min,pts,reb,ast,tpm,threeAtt,hasPossessions,fga:fg,fta:ft,orb:statValue(offRebounds),tov:statValue(turnovers)});
      }
    }
  }
  return rows;
}
function parseInjuries(raw){
  const result=[],seen=new Set();
  const lists=Array.isArray(raw?.injuries)?raw.injuries:[];
  for(const group of lists){
    // ESPN often nests injuries by team; older response versions have player rows directly.
    const entries=Array.isArray(group.injuries)?group.injuries:[group];
    for(const entry of entries){
      const athlete=entry.athlete||entry.player||group.athlete||{};
      const name=athlete.displayName||athlete.fullName||athlete.name||entry.name||'';
      const t=group.team||entry.team||athlete.team||{};
      const team=normTeam(t.abbreviation||t.abbr||t.shortDisplayName||t);
      const id=athlete.id?String(athlete.id):null;
      const rawStatus=entry.details?.fantasyStatus?.description || entry.details?.fantasyStatus?.abbreviation || entry.fantasy?.status || entry.status?.description || entry.status?.name || entry.status || '';
      const status=typeof rawStatus==='string'?rawStatus:String(rawStatus?.name||'');
      const detail=entry.shortComment||entry.longComment||entry.details?.type||entry.type?.description||'';
      if(!name||!team||!TEAMS.some(x=>x.abbr===team))continue;
      const key=team+'|'+(id||name.toLowerCase());if(seen.has(key))continue;seen.add(key);
      result.push({team,id,name,status,detail:String(detail).slice(0,200)});
    }
  }
  return result;
}
async function getJSON(url,maxTries=3){
  for(let retry=0;retry<maxTries;retry++){
    try{
      const signal=AbortSignal.timeout(16000);
      const r=await fetch(url,{signal,headers:{accept:'application/json'}});
      if(!r.ok)throw Error(`ESPN responded ${r.status}${r.status===429?' (rate limit)':''}`);
      const x=await r.json(); if(!x||typeof x!=='object')throw Error('Invalid JSON');
      return x;
    }catch(e){if(retry>=maxTries-1)throw e;await pause(1000*(retry+1)**2);}
  }
}
function auditFingerprint(games){
  const fingerprint='opportunity-v2;'+games.map(g=>`${g.id}|${g.date}|${g.players?.length||0}`).sort().join(';');
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
}
function updateAudit(games,{force=false}={}){
  const filterGames=games.filter(g=>g.completed && g.players?.length && (g.seasonType==null||Number(g.seasonType)===2) && g.date.slice(0,10)>=currentPeriod().start);
  const fingerprint=auditFingerprint(filterGames);
  if(!force&&audit?.fingerprint===fingerprint)return;
  if(!force && storage.mode!=='postgres'){
    try{const saved=JSON.parse(fs.readFileSync(BACKTEST_FILE,'utf8'));
      if(saved.fingerprint===fingerprint){audit=saved;return;}
    }catch{}
  }
  audit=createBacktest(filterGames,{startDate:currentPeriod().start});
  audit.fingerprint=fingerprint;
  // Persisted transactionally with the cache; not written to ephemeral cloud disk.
}
function rebuild(){
  const all=Object.values(cache.games||{});
  updateAudit(all);
  const today=localDate(),tomorrow=addDays(today,1);
  const possible=Object.values(cache.scores||{}).flatMap(v=>v.events||[]);
  const unique=new Map(possible.filter(g=>g.date&&[today,tomorrow].includes(localDate(new Date(g.date)))).map(g=>[g.id,g]));
  dashboard=buildAnalysis(all,[...unique.values()],cache.injuries,{targetDate:today,includeNeutral:process.env.SHOT_TENDENCIES_ENABLED==='1',includeCompleted:true,startDate:currentPeriod().start,model:audit?.status==='evaluated'?audit.selectedModel:defaultModel()});
  dashboard.slateDates=[today,tomorrow];
  dashboard.backtest={status:audit?.status||'insufficient',observations:audit?.observations||0,training:audit?.training||null,holdout:audit?.holdout||null,models:audit?.models||null};
  dashboard.lastUpdated=cache.lastUpdated||null;
  dashboard.source='ESPN public game summaries, scoreboard and injuries';
  dashboard.nextGamesFound=unique.size;
  dashboard.coverage=coverage();
}
function currentPeriod(){
  const today=localDate();
  const y=Number(today.slice(0,4)),m=Number(today.slice(5,7));
  const seasonYear=m<8?y-1:y;
  const begin=`${seasonYear}-10-01`;
  const lookback=addDays(today,-65);
  const start=begin>lookback?begin:lookback;
  const end=addDays(today,1);
  return {start,end};
}
async function refresh(){
  if(job.running)return;
  job={running:true,phase:'Preparing schedule',done:0,total:0,lastUpdated:cache.lastUpdated||null,error:null,warnings:[],completed:0,coverage:null};
  try{
    const {start,end}=currentPeriod();
    const today=localDate();
    const days=dateRange(start,end);
    const scoreNeeded=days.filter(d=>!cache.scores?.[d]||d>=addDays(today,-2));
    let freshScoreboards=0;
    job.phase='Reading NBA schedule and completed scores';job.total=scoreNeeded.length;
    for(const d of scoreNeeded){
      try{
        const data=await getJSON(`${BASE}/scoreboard?dates=${dateKey(d)}&limit=200`);
        const events=(data.events||[]).map(eventFromESPN).filter(g=>g.home&&g.away&&g.date);
        cache.scores[d]={fetchedAt:now(),events};
        if(d>=addDays(today,-2))freshScoreboards++;
      }catch(e){job.warnings.push(`${d}: ${e.message}`);}
      job.done++;if(job.done%8===0)await persist();
      await pause(420);
    }
    await persist();
    const recentScoreDays=days.filter(d=>Array.isArray(cache.scores[d]?.events));
    if(!recentScoreDays.length)throw Error('Unable to download any NBA scoreboards. Check internet access to ESPN and try again.');
    if(!freshScoreboards)throw Error('Unable to verify any recent NBA scoreboards. Cached data is preserved; update was not marked successful.');
    const events=new Map(days.flatMap(d=>cache.scores[d]?.events||[]).map(e=>[e.id,e]));
    const completed=[...events.values()].filter(e=>e.completed && !cache.games[e.id]);
    job.phase='Importing final player box scores';job.done=0;job.total=completed.length;
    for(const e of completed){
      try{
        const data=await getJSON(`${BASE}/summary?event=${encodeURIComponent(e.id)}`);
        const players=extractBox(data,e);
        if(players.length>=5){cache.games[e.id]={...e,players};job.completed++;}
        else job.warnings.push(`${e.description||e.id}: player box score not ready (${players.length} parsed)`);
      }catch(err){job.warnings.push(`Game ${e.id}: ${err.message}`);}
      job.done++;if(job.done%8===0)await persist();
      await pause(500);
    }
    await persist();
    if(completed.length && !Object.values(cache.games).some(g=>Array.isArray(g.players)&&g.players.length))throw Error('Scoreboards loaded, but no player box scores were readable. ESPN may have blocked or changed its summaries.');
    job.phase='Checking injury statuses';job.done=0;job.total=1;
    try{
      const data=await getJSON(`${BASE}/injuries`);
      const records=parseInjuries(data);
      cache.injuries={available:true,records,fetchedAt:now()};
    }catch(e){cache.injuries={available:false,records:[],fetchedAt:null};job.warnings.push(`Injury data unavailable: ${e.message}`);}
    job.done=1;job.phase='Backtesting prior games and recalculating ratings';
    cache.lastUpdated=now();rebuild();job.coverage=dashboard.coverage;await persist();
    if(job.coverage.missing)job.warnings.push(`${job.coverage.missing} of ${job.coverage.expected} completed games are missing readable box scores`);
    job.lastUpdated=cache.lastUpdated;job.phase='Complete';
  }catch(e){job.error=e.message;job.phase='Refresh failed';}
  finally{job.running=false; if(job.warnings.length)console.warn('ESPN source warnings:',job.warnings.slice(0,10));job.warnings=job.warnings.slice(0,35);}
}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url||'/',`http://127.0.0.1:${PORT}`);
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(data));};
  if(u.pathname==='/api/health'&&req.method==='GET')return send(200,{ok:true,storage:storage.mode,ready:!!dashboard});
  if(u.pathname==='/api/status'&&req.method==='GET')return send(200,{...job,cacheGames:Object.keys(cache.games).length,storage:storage.mode,protected:PROTECTED});
  if(u.pathname==='/api/backtest'&&req.method==='GET')return send(200,audit||{status:'insufficient',observations:0});
  if(u.pathname==='/api/backtest/recalculate'&&req.method==='POST'){
    if(!authorized(req))return send(401,{error:'Authorisation required'});
    if(job.running)return send(409,{error:'Refresh underway; run the audit after syncing completes'});
    try{updateAudit(Object.values(cache.games||{}),{force:true});rebuild();await persist();return send(200,{ok:true,status:audit.status,observations:audit.observations});}
    catch(e){return send(500,{error:e.message});}
  }
  if(u.pathname==='/api/dashboard'&&req.method==='GET'){
    // The target date shifts in Australia/Melbourne even if the app remains open overnight.
    if(!dashboard || dashboard.targetDate!==localDate())rebuild();
    return send(200,dashboard);
  }
  if((u.pathname==='/api/refresh'||u.pathname==='/api/hooks/refresh')&&req.method==='POST'){
    if(!authorized(req))return send(401,{error:'Authorisation required. Enter the update token configured on the server.'});
    if(job.running)return send(200,{ok:true,alreadyRunning:true});
    refresh().catch(e=>console.error('Refresh error:',e));return send(202,{ok:true,alreadyRunning:false});
  }
  if(u.pathname.startsWith('/api/'))return send(404,{error:'Unknown API path'});
  if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed'});
  const pathname=u.pathname==='/'?'/index.html':u.pathname;
  let file;
  try{file=path.resolve(PUBLIC,'.'+decodeURIComponent(pathname));}
  catch{return send(400,{error:'Invalid URL encoding'});}
  if(!file.startsWith(PUBLIC+path.sep))return send(403,{error:'Forbidden'});
  fs.readFile(file,(err,buf)=>{
    if(err){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:buf);
  });
});
async function initialize(){
  if(PROTECTED && ADMIN_TOKEN.length<24)throw Error('Set ADMIN_TOKEN to a long secret (at least 24 characters) before running online.');
  // A newly provisioned Railway PostgreSQL service can take a moment to accept connections.
  let saved;
  for(let attempt=1;attempt<=5;attempt++){
    try{saved=await storage.start();break;}
    catch(error){if(attempt===5 || storage.mode!=='postgres')throw error;
      console.warn(`Database not ready (attempt ${attempt}/5): ${error.message}`);
      await pause(2000*attempt);
    }
  }
  if(saved.cache)cache=saved.cache;
  if(saved.audit)audit=saved.audit;
  job.lastUpdated=cache.lastUpdated||null;
  rebuild();
}
function enableAutomaticSync(){
  const hours=Number(process.env.AUTO_REFRESH_HOURS||0);
  if(!Number.isFinite(hours)||hours<0)throw Error('AUTO_REFRESH_HOURS must be a non-negative number.');
  if(hours===0){
    if(process.env.REFRESH_ON_START==='1')setTimeout(()=>{if(!job.running)refresh().catch(e=>console.error('Initial refresh failed:',e.message));},5000).unref();
    return;
  }
  if(hours<1)throw Error('AUTO_REFRESH_HOURS must be at least 1 to prevent excessive source requests.');
  const timer=setInterval(()=>{if(!job.running)refresh().catch(e=>console.error('Automatic refresh failed:',e.message));},hours*3600000);
  timer.unref();
  if(process.env.REFRESH_ON_START==='1')setTimeout(()=>{if(!job.running)refresh().catch(e=>console.error('Initial refresh failed:',e.message));},5000).unref();
}
if(require.main===module){initialize().then(()=>server.listen(PORT,HOST,()=>{
  console.log(`NBA Matchup Lab listening on ${HOST}:${PORT} (storage: ${storage.mode})`);
  console.log(`Historical games cached: ${Object.keys(cache.games).length}.`);
  enableAutomaticSync();
})).catch(e=>{console.error('Startup failed:',e.message);process.exitCode=1;});}
for(const signal of ['SIGTERM','SIGINT']){
  if(require.main===module)process.on(signal,()=>{console.log(`Received ${signal}, closing HTTP server`);server.close(()=>storage.close().finally(()=>process.exit(0)));});
}
module.exports={server,extractBox,parseInjuries,eventFromESPN,parseMinutes,rebuild,initialize,refresh,snapshot:()=>({dashboard,audit,status:{...job,cacheGames:Object.keys(cache.games).length,storage:"static",protected:true}})};
