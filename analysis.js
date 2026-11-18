'use strict';

const {buildOpportunity,combineProjection}=require('./opportunity');
const ZONE = 'Australia/Melbourne';
const STATS = ['pts', 'reb', 'ast'];
const {defaultModel,projection,clamp} = require('./model');
const TEAMS = [
  ['ATL','Atlanta Hawks'],['BOS','Boston Celtics'],['BKN','Brooklyn Nets'],['CHA','Charlotte Hornets'],
  ['CHI','Chicago Bulls'],['CLE','Cleveland Cavaliers'],['DAL','Dallas Mavericks'],['DEN','Denver Nuggets'],
  ['DET','Detroit Pistons'],['GSW','Golden State Warriors'],['HOU','Houston Rockets'],['IND','Indiana Pacers'],
  ['LAC','LA Clippers'],['LAL','Los Angeles Lakers'],['MEM','Memphis Grizzlies'],['MIA','Miami Heat'],
  ['MIL','Milwaukee Bucks'],['MIN','Minnesota Timberwolves'],['NOP','New Orleans Pelicans'],['NYK','New York Knicks'],
  ['OKC','Oklahoma City Thunder'],['ORL','Orlando Magic'],['PHI','Philadelphia 76ers'],['PHX','Phoenix Suns'],
  ['POR','Portland Trail Blazers'],['SAC','Sacramento Kings'],['SAS','San Antonio Spurs'],['TOR','Toronto Raptors'],
  ['UTA','Utah Jazz'],['WAS','Washington Wizards']
].map(([abbr,name])=>({abbr,name}));
const TEAM_ALIASES = {GS:'GSW',GOLDENSTATE:'GSW',NY:'NYK',NO:'NOP',SA:'SAS',UTAH:'UTA',WSH:'WAS',PHO:'PHX',BKN:'BKN'};
const ROLES = {
  G: ['Pass-first guard','Scoring guard','Off-ball guard'],
  F: ['Playmaking forward','Scoring forward','Floor-spacing forward','Rebounding forward','Utility forward'],
  PG: ['Pass-first PG','Scoring PG','Combo PG'],
  SG: ['Playmaking SG','High-volume SG','Off-ball SG'],
  SF: ['Point forward','Scoring wing','Floor-spacing wing','Utility wing'],
  PF: ['Playmaking PF','Scoring PF','Stretch PF','Rebounding PF','Utility PF'],
  C: ['Playmaking C','Scoring C','Stretch C','Rebounding C','Interior C']
};
const ALL_ROLES = Object.entries(ROLES).flatMap(([pos,rs])=>rs.map(role=>({position:pos,role})));
const DISPLAY_ROLES = Object.entries(ROLES).flatMap(([pos,rs])=>[{position:pos,role:`All ${pos}s`},...rs.map(role=>({position:pos,role}))]);
const EPS=0.00001;
const round=(n,d=1)=> Number.isFinite(n)?Number(n.toFixed(d)):0;
const safeNum=v=>Number.isFinite(+v)?Number(v):0;
function normTeam(v) {return TEAM_ALIASES[String(v||'').toUpperCase()]||String(v||'').toUpperCase();}
function localDate(input=new Date(),zone=ZONE) {
  const bits=Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(input);
  const get=k=>bits.find(b=>b.type===k)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function addDays(date,days) {
  const d=new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
function dateKey(date) {return date.replace(/-/g,'');}
function dateRange(start,end) {
  const result=[];
  for(let d=start;d<=end;d=addDays(d,1)) result.push(d);
  return result;
}
function positionOf(v) {
  const str=String(v||'').toUpperCase().replace(/[^A-Z]/g,'');
  if(['G','F','PG','SG','SF','PF','C'].includes(str)) return str;
  if(str==='GUARD')return 'G';
  if(str==='FORWARD')return 'F';
  if(str==='POINTGUARD')return 'PG';
  if(str==='SHOOTINGGUARD')return 'SG';
  if(str==='SMALLFORWARD')return 'SF';
  if(str==='POWERFORWARD')return 'PF';
  if(str==='CENTER'||str==='CENTRE')return 'C';
  return null;
}
function roleFor(p) {
  const a=p.avg||{}; const pts=a.pts||0,reb=a.reb||0,ast=a.ast||0,three=a.threeAtt||0;
  switch(p.position) {
    case 'G': return ast>=4.5?'Pass-first guard':pts>=16?'Scoring guard':'Off-ball guard';
    case 'F': return ast>=4.3?'Playmaking forward':pts>=17.5?'Scoring forward':three>=3.5?'Floor-spacing forward':reb>=7?'Rebounding forward':'Utility forward';
    case 'PG': return ast>=6.2 && ast>=pts*.27?'Pass-first PG':pts>=18?'Scoring PG':'Combo PG';
    case 'SG': return ast>=4.5?'Playmaking SG':pts>=16?'High-volume SG':'Off-ball SG';
    case 'SF': return ast>=4.5?'Point forward':pts>=17.5?'Scoring wing':three>=3.5?'Floor-spacing wing':'Utility wing';
    case 'PF': return ast>=4.3?'Playmaking PF':pts>=19?'Scoring PF':three>=3.7?'Stretch PF':reb>=7?'Rebounding PF':'Utility PF';
    case 'C': return ast>=4.2?'Playmaking C':pts>=19?'Scoring C':three>=2.8?'Stretch C':reb>=9?'Rebounding C':'Interior C';
    default: return null;
  }
}
function makeBlank(){return {n:0,minutes:0,pts:0,reb:0,ast:0,gameIds:new Set(),playerIds:new Set()};}
function addObs(b,row){b.n++;b.minutes+=row.min||0;b.pts+=row.pts||0;b.reb+=row.reb||0;b.ast+=row.ast||0;b.gameIds.add(row.gameId);b.playerIds.add(row.id);}
function statsOf(b){return {n:b.n,games:b.gameIds.size,players:b.playerIds.size,minutes:round(b.minutes,0),pts:round(b.pts/(b.n||1)),reb:round(b.reb/(b.n||1)),ast:round(b.ast/(b.n||1)),per36:{pts:round(b.pts/(b.minutes||1)*36),reb:round(b.reb/(b.minutes||1)*36),ast:round(b.ast/(b.minutes||1)*36)}};}
function getObj(map,key){if(!map.has(key))map.set(key,makeBlank());return map.get(key);}
function mapStats(map){return Object.fromEntries([...map].map(([k,v])=>[k,statsOf(v)]));}
const teamKeys=(team,pos,role)=>[`${team}|${pos}|${role}`,`${team}|${pos}|*`];

function paceTable(games){
  const totals=new Map();let allPoss=0,allCount=0;
  for(const g of games){
    for(const team of [g.home,g.away]){
      const players=g.players.filter(x=>normTeam(x.team)===team);
      if(players.length<5||players.filter(x=>x.hasPossessions).length<5)continue;
      const sum=k=>players.reduce((a,x)=>a+(x[k]||0),0);
      const poss=sum('fga')+.44*sum('fta')-sum('orb')+sum('tov');
      if(poss<65||poss>150)continue;
      const item=totals.get(team)||{n:0,sum:0};item.n++;item.sum+=poss;totals.set(team,item);
      allPoss+=poss;allCount++;
    }
  }
  return {totals,mean:allCount?allPoss/allCount:null,teams:totals.size};
}
function paceFeature(table,offense,defense){
  if(!table.mean||table.mean<75)return 0;
  const a=table.totals.get(offense),b=table.totals.get(defense);
  if(!a||!b)return 0;
  const combined=(a.sum/a.n+b.sum/b.n)/2;
  const credibility=Math.min(1,Math.min(a.n,b.n)/8);
  return clamp((combined/table.mean-1)*credibility,-.15,.15);
}
function roleFeatures(role,league,pos,lpos,stat){
  const rRatio=role&&league&&league.per36?.[stat]>EPS ? role.per36[stat]/league.per36[stat]-1 : 0;
  const pRatio=pos&&lpos&&lpos.per36?.[stat]>EPS ? pos.per36[stat]/lpos.per36[stat]-1 : 0;
  return {role:clamp(rRatio,-.5,.5)*(role?role.n/(role.n+8):0),position:clamp(pRatio,-.5,.5)*(pos?pos.n/(pos.n+14):0)};
}

function buildAnalysis(games, upcoming=[], injuryInfo={available:false,records:[]}, options={}) {
  const cutoff=options.startDate||'0000-01-01';
  const all=games.filter(g=>g.completed && g.date?.slice(0,10)>=cutoff && (g.seasonType==null||Number(g.seasonType)===2) && Array.isArray(g.players) && g.players.length);
  const recent=all.sort((a,b)=>a.date.localeCompare(b.date));
  const playerMap=new Map(), perGameMap=new Map(), byTeamGame=new Map();
  for(const g of recent){
    const teamSets = new Map();
    for(const x of g.players){
      const pos=positionOf(x.position);
      if(!pos || !x.id || !(x.min>=6) || !x.team || !x.opponent)continue;
      let p=playerMap.get(String(x.id));
      if(!p){p={id:String(x.id),name:x.name,team:normTeam(x.team),position:pos,lines:[],teamHistory:new Set()};playerMap.set(String(x.id),p);}
      p.name=x.name||p.name;p.team=normTeam(x.team);p.position=pos;
      const row={id:String(x.id),name:p.name,team:normTeam(x.team),opponent:normTeam(x.opponent),position:pos,gameId:g.id,date:g.date,min:x.min,pts:x.pts,reb:x.reb,ast:x.ast,threeAtt:x.threeAtt||0,fga:x.fga||0,fta:x.fta||0};
      p.lines.push(row);p.teamHistory.add(row.team);
      perGameMap.set(`${g.id}|${x.id}`,row);
      if(!teamSets.has(row.team))teamSets.set(row.team,new Set());
      teamSets.get(row.team).add(row.id);
    }
    for(const [t,set]of teamSets)byTeamGame.set(`${g.id}|${t}`,set);
  }
  const players=[];
  for(const p of playerMap.values()){
    const teamLines=p.lines.filter(x=>x.team===p.team);
    const n=teamLines.length;
    if(!n)continue;
    let totals={pts:0,reb:0,ast:0,min:0,threeAtt:0};
    teamLines.forEach(x=>{for(const k of Object.keys(totals))totals[k]+=(x[k]||0);});
    p.avg=Object.fromEntries(Object.keys(totals).map(k=>[k,round(totals[k]/n,2)]));
    p.n=n;p.role=roleFor(p);
    const last5=teamLines.slice(-5);
    p.recent=Object.fromEntries(STATS.map(k=>[k,round(last5.reduce((a,x)=>a+x[k],0)/last5.length,2)]));
    p.lastPlayed=teamLines.at(-1).date;
    p.lines=teamLines;
    players.push(p);
  }
  const active=new Map(players.map(p=>[p.id,p]));
  const allowedMap=new Map(), leagueMap=new Map(), roleMap=new Map();
  for(const g of all)for(const x of g.players){
    const p=active.get(String(x.id));
    const pos=positionOf(x.position);
    if(!p||!pos||!(x.min>=6))continue;
    const role = p.position===pos ? p.role : roleFor({...p,position:pos});
    if(!role)continue;
    const row={id:String(x.id),gameId:g.id,min:x.min,pts:x.pts,reb:x.reb,ast:x.ast};
    const defense=normTeam(x.opponent);
    for(const key of teamKeys(defense,pos,role))addObs(getObj(allowedMap,key),row);
    for(const key of [`*|${pos}|${role}`,`*|${pos}|*`])addObs(getObj(leagueMap,key),row);
    addObs(getObj(roleMap,role),row);
  }
  const allowed=mapStats(allowedMap),league=mapStats(leagueMap);
  const pace=paceTable(all);
  const weights=options.model||defaultModel();
  const injuries=normalizeInjuries(injuryInfo.records||[]);
  const teams = TEAMS.map(t=>({...t,games:all.filter(g=>g.home===t.abbr||g.away===t.abbr).length}));
  const teamData={};
  for(const t of teams){
    const arr=[];
    for(const {position,role}of DISPLAY_ROLES){
      const purePosition=role===`All ${position}s`;
      const a=allowed[`${t.abbr}|${position}|${purePosition?'*':role}`]||null;
      const l=league[`*|${position}|${purePosition?'*':role}`]||null;
      const pos=allowed[`${t.abbr}|${position}|*`]||null;
      const lp=league[`*|${position}|*`]||null;
      const vs={},delta={};
      for(const k of STATS){vs[k]=round(100*(contextRatio(a,l,pos,lp,k)-1),1);delta[k]=a&&l?round(a[k]-l[k],1):null;}
      arr.push({position,role,...(a||{n:0,games:0,players:0,pts:0,reb:0,ast:0,per36:{pts:0,reb:0,ast:0}}),vs,delta,league:l||null,positionSample:pos?.n||0});
    }
    teamData[t.abbr]=arr;
  }
  const injuryByTeam={};
  for(const i of injuries){if(!injuryByTeam[i.team])injuryByTeam[i.team]=[];injuryByTeam[i.team].push(i);}
  const matches=[];
  const future=upcoming.filter(g=>(options.includeCompleted||!g.completed) && g.home && g.away);
  for(const game of future){
    const result={...game,players:[],injuries:[...(injuryByTeam[game.home]||[]),...(injuryByTeam[game.away]||[])]};
    // Separate roster lookup from signal thresholds: neutral and bench players belong here too.
    const finalBox=game.completed?all.find(g=>String(g.id)===String(game.id)):null;
    result.rolePlayers=players.filter(p=>[game.home,game.away].includes(p.team)&&
      (finalBox?finalBox.players.some(x=>String(x.id)===p.id&&x.team===p.team&&x.min>0):
        Date.parse(game.date)-Date.parse(p.lastPlayed)<15*86400000)).map(p=>({
      id:p.id,name:p.name,team:p.team,position:p.position,role:p.role,avg:p.avg,
      injury:game.completed?null:injuries.find(i=>(i.id&&String(i.id)===p.id)||(!i.id&&i.team===p.team&&i.name.toLowerCase()===p.name.toLowerCase()))||null
    }));
    result.rolePlayersSource=finalBox?'Final box score':'Recent roster';
    if(game.completed){matches.push(result);continue;}
    for(const offensive of [game.home,game.away]){
      const defensive=offensive===game.home?game.away:game.home;
      const teamOuts=(injuryByTeam[offensive]||[]).filter(i=>['out','doubtful'].includes(i.status));
      const asOf=Date.parse(options.asOf||new Date().toISOString());
      const fresh=!!injuryInfo.available&&Number.isFinite(Date.parse(injuryInfo.fetchedAt))&&asOf-Date.parse(injuryInfo.fetchedAt)>=0&&asOf-Date.parse(injuryInfo.fetchedAt)<24*3600000;
      const opportunity=options.skipInjury?new Map():buildOpportunity(players,offensive,teamOuts,all,{fresh,gameDate:game.date});
      const starters=players.filter(p=>p.team===offensive && p.n>=3 && (options.skipInjury?p.avg.min>=16:(opportunity.get(p.id)?.projectedMinutes||0)>=16));
      const predictedPace=paceFeature(pace,offensive,defensive);
      for(const p of starters){
        const inj = injuries.find(i=>(i.id && i.id===p.id)||(!i.id&&i.team===offensive&&i.name.toLowerCase()===p.name.toLowerCase()));
        if(inj && ['out','doubtful'].includes(inj.status))continue;
        const defendingInjuries=(injuryByTeam[defensive]||[]).filter(i=>i.status==='out');
        const teammateInjuries=(injuryByTeam[offensive]||[]).filter(i=>i.status==='out'&&i.id!==p.id&&i.name.toLowerCase()!==p.name.toLowerCase());
        const context=opportunity.get(p.id);
        const statLines={};
        for(const stat of STATS){
          const roleRow=allowed[`${defensive}|${p.position}|${p.role}`];
          const roleLeague=league[`*|${p.position}|${p.role}`];
          const posRow=allowed[`${defensive}|${p.position}|*`];
          const posLeague=league[`*|${p.position}|*`];
          const sample=roleRow?.n||0;
          const roleGames=roleRow?.games||0;
          const base=p.avg[stat];
          const feature={...roleFeatures(roleRow,roleLeague,posRow,posLeague,stat),
            recent:p.n>=5&&base>EPS?clamp(p.recent[stat]/base-1,-.5,.5):0,
            pace:predictedPace};
          const injury={delta:0,evidence:0}; // handled as minutes + per-minute opportunity, once
          const defenseInj=options.skipInjury||!fresh?{delta:0,evidence:0}:calcDefenseAdjustment(defensive,p,stat,defendingInjuries,all,perGameMap,byTeamGame);
          const environment=projection(base,{...feature,recent:0},weights[stat],defenseInj.delta);
          const result=options.skipInjury?projection(base,feature,weights[stat]):combineProjection(p,stat,environment,context,weights[stat]);
          const individual=options.skipInjury?0:Math.abs(result.components.minutes+result.components.form+result.components.injury)/Math.max(1,base);
          const enough = p.n>=4 && ((sample>=5 || (posRow?.n||0)>=10)||individual>=.04);
          const score=round((options.skipInjury?result.matchup:result.total)*100,1);
          const meaningful=options.skipInjury||Math.abs(result.projection-base)>={pts:1.5,reb:.8,ast:.6}[stat];
          const level=!enough?'limited':!meaningful?'neutral':score>=17?'strong-positive':score>=10?'positive':score<=-17?'strong-negative':score<=-10?'negative':'neutral';
          statLines[stat]={base:round(base),projection:round(result.projection),edge:score,totalEdge:round(result.total*100,1),formEdge:round((options.skipInjury?result.components.recent:result.components.form/Math.max(1,base))*100,1),paceEdge:round(environment.components.pace*100,1),level,roleAllowed:roleRow?roleRow[stat]:null,leagueRole:roleLeague?roleLeague[stat]:null,roleN:sample,roleGames,positionN:posRow?.n||0,injuryDelta:round(injury.delta*100,1),defenseInjuryDelta:round(defenseInj.delta*100,1),injuryUsed:injury.evidence,defenseInjuryUsed:defenseInj.evidence,limited:!enough,features:feature,delta:round(result.projection-base),components:options.skipInjury?null:Object.fromEntries(Object.entries(result.components).map(([k,v])=>[k,round(v)])),defenseEdge:round(environment.matchup*100,1)};
        }
        const hasMajor=STATS.some(s=>['strong-positive','strong-negative'].includes(statLines[s].level));
        const hasSignal=STATS.some(s=>['strong-positive','positive','strong-negative','negative'].includes(statLines[s].level));
        if(!hasSignal && !options.includeNeutral)continue;
        const notes=[];
        for(const stat of STATS){
          const x=statLines[stat];
          if(['strong-positive','strong-negative','positive','negative'].includes(x.level)){
            const compared=x.roleAllowed!=null?`${x.roleAllowed} ${stat.toUpperCase()} per player game to ${p.role}s (${x.roleN} observations)`:`limited role-specific history`;
            notes.push(`${stat.toUpperCase()} projected ${x.projection} vs ${x.base} baseline, including player minutes and opportunity. Opponent context: ${defensive} allow ${compared}`);
          }
        }
        if(teammateInjuries.length)notes.push(`Reported out: ${teammateInjuries.slice(0,2).map(i=>i.name).join(', ')}${teammateInjuries.length>2?' + more':''}. Minutes and per-minute opportunity use observed splits or explicitly labelled estimates; existing absences are not boosted twice.`);
        if(defendingInjuries.length)notes.push(`${defensive} reported out: ${defendingInjuries.slice(0,2).map(i=>i.name).join(', ')}; defensive adjustment requires sufficient comparable games.`);
        if(inj && ['questionable','probable','day-to-day'].includes(inj.status))notes.push(`${p.name} is ${inj.status}: availability/minutes uncertain.`);
        result.players.push({id:p.id,name:p.name,team:p.team,position:p.position,role:p.role,avg:p.avg,recent:p.recent,played:p.n,lastPlayed:p.lastPlayed,injury:inj||null,context:context||null,stats:statLines,major:hasMajor,maxEdge:Math.max(...STATS.map(s=>Math.abs(statLines[s].edge))),notes,teammateOut:teammateInjuries.map(i=>i.name)});
      }
    }
    result.players.sort((a,b)=>Number(b.major)-Number(a.major)||b.maxEdge-a.maxEdge);
    matches.push(result);
  }
  const highlights=matches.flatMap(m=>m.players.map(p=>({...p,opponent:p.team===m.home?m.away:m.home,eventId:m.id,gameDate:m.date}))).sort((a,b)=>Number(b.major)-Number(a.major)||b.maxEdge-a.maxEdge);
  const date=localDate();
  return {generatedAt:new Date().toISOString(),targetDate:options.targetDate||addDays(date,1),sample:{games:all.length,players:players.length,first:all[0]?.date?.slice(0,10)||null,last:all.at(-1)?.date?.slice(0,10)||null},teams,roles:DISPLAY_ROLES,league,teamData,matches,highlights,injuries:{available:!!injuryInfo.available,fetchedAt:injuryInfo.fetchedAt||null,count:injuries.length},methodology:{window:'Rolling current-season completed games (max 65 days, regular-season only when labelled)',thresholds:'Live signals use total projected change versus season baseline: 10% ordinary, 17% strong, plus at least 1.5 points / 0.8 rebounds / 0.6 assists. Not betting probabilities.',injury:'Minutes deviations receive 60% weight, capped at +/-20% of baseline output. Defensive matchup and injury-related per-minute usage retain their existing weights. Fresh reported outs drive observed with/without splits or capped estimated role redistribution. Minutes are estimates, not confirmed lineups. The live opportunity overlay is not included in the historical backtest.',model:'Out-of-sample backtesting tunes recency, role, position and available pace feature coefficients. Matching historical game results are never used as inputs.'}};
}
function contextRatio(role,league,pos,lpos,stat){
  // Role-specific defence signal, backed off to positional rates and 1.0 for small samples.
  const rRatio=role&&league&&league[stat]>EPS ? role.per36[stat]/(league.per36[stat]||1) : 1;
  const pRatio=pos&&lpos&&lpos[stat]>EPS ? pos.per36[stat]/(lpos.per36[stat]||1) : 1;
  const wr=role?role.n/(role.n+8):0;
  const wp=pos?pos.n/(pos.n+14):0;
  const ratio=1+(Math.max(.5,Math.min(1.5,rRatio))-1)*wr*.8+(Math.max(.5,Math.min(1.5,pRatio))-1)*wp*.28;
  return Math.max(.72,Math.min(1.28,ratio));
}
function normalizeInjuries(arr){
  const clean=[];const seen=new Set();
  for(const r of arr){
    const team=normTeam(r.team||r.teamAbbr||r.teamAbbreviation);
    const id=r.id!=null?String(r.id):null;
    const name=String(r.name||r.player||'').trim();
    if(!name||!team||!TEAMS.some(t=>t.abbr===team))continue;
    const raw=String(r.status||'').toLowerCase().replace(/_/g,' ');
    let status='unknown';
    if(/(^|\W)out(\W|$)|injured reserve|inactive|suspension/.test(raw))status='out';
    else if(/doubtful/.test(raw))status='doubtful';
    else if(/questionable/.test(raw))status='questionable';
    else if(/probable/.test(raw))status='probable';
    else if(/day.*to.*day|daytoday/.test(raw))status='day-to-day';
    else if(/available|active/.test(raw))status='available';
    const key=`${team}|${id||name.toLowerCase()}`;
    if(seen.has(key))continue;seen.add(key);
    clean.push({team,id,name,status,detail:r.detail||''});
  }
  return clean;
}
function calcTeammateAdjustment(player,stat,outs,games,byTeamGame){
  if(!outs.length)return {delta:0,evidence:0};
  const sample=player.lines||[];let best={delta:0,evidence:0};
  for(const injured of outs){
    const id=injured.id;if(!id)continue;
    const had=[],missed=[];
    for(const line of sample){
      const tset=byTeamGame.get(`${line.gameId}|${player.team}`);
      if(!tset)continue;
      (tset.has(id)?had:missed).push(line);
    }
    if(had.length<3||missed.length<3)continue;
    const mean=a=>a.reduce((sum,r)=>sum+r[stat],0)/a.length;
    const present=mean(had), absent=mean(missed);
    if(present<1)continue;
    const delta=Math.max(-.16,Math.min(.16,(absent/present-1)*.32));
    if(Math.abs(delta)>Math.abs(best.delta))best={delta,evidence:Math.min(had.length,missed.length)};
  }
  return best;
}
function calcDefenseAdjustment(defense,player,stat,outs,games,perGameMap,byTeamGame){
  // Change only if past games both with and without the reported out defender have >= 3 role-identified comparables.
  if(!outs.length)return {delta:0,evidence:0};
  let best={delta:0,evidence:0};
  for(const injured of outs){
    if(!injured.id)continue;
    const withD=[],withoutD=[];
    for(const g of games){
      if(g.home!==defense && g.away!==defense)continue;
      const tset=byTeamGame.get(`${g.id}|${defense}`);
      if(!tset)continue;
      for(const x of g.players){
        if(normTeam(x.opponent)!==defense || positionOf(x.position)!==player.position || !(x.min>=12))continue;
        const comparable=String(x.id)===player.id || (x.pts>=0);
        if(!comparable)continue;
        (tset.has(injured.id)?withD:withoutD).push({s:x[stat],min:x.min});
      }
    }
    if(withD.length<3||withoutD.length<3)continue;
    const rate=a=>a.reduce((sum,x)=>sum+x.s,0)/Math.max(1,a.reduce((sum,x)=>sum+x.min,0));
    if(rate(withD)<=EPS)continue;
    const delta=Math.max(-.1,Math.min(.1,(rate(withoutD)/rate(withD)-1)*.23));
    if(Math.abs(delta)>Math.abs(best.delta))best={delta,evidence:Math.min(withD.length,withoutD.length)};
  }
  return best;
}
module.exports={TEAMS,STATS,ROLES,ALL_ROLES,DISPLAY_ROLES,normTeam,localDate,addDays,dateKey,dateRange,positionOf,roleFor,buildAnalysis,normalizeInjuries,contextRatio,roleFeatures,paceTable,paceFeature,round};
