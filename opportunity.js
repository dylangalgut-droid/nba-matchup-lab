'use strict';
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number.isFinite(v)?v:0));
const mean=(a,k)=>a.length?a.reduce((s,x)=>s+(x[k]||0),0)/a.length:0;
const rate=(a,k)=>a.reduce((s,x)=>s+(x[k]||0),0)/Math.max(1,a.reduce((s,x)=>s+x.min,0));
const group=p=>['PG','SG','G'].includes(p)?'G':['SF','PF','F'].includes(p)?'F':'C';
const affinity=(a,b)=>group(a)===group(b)?1:group(a)!=='G'&&group(b)!=='G'?.6:.2;
// A transparent live-only scenario overlay, not a fitted injury model or a confirmed lineup.
function buildOpportunity(players,team,outs,games,{fresh=true,gameDate}={}){
 const teamGames=games.filter(g=>g.home===team||g.away===team).slice(-3);
 const reference=Date.parse(gameDate||teamGames.at(-1)?.date||0);
 const roster=players.filter(p=>p.team===team&&p.n>=3&&p.avg.min>=8&&reference-Date.parse(p.lastPlayed)<15*86400000);
 const unavailable=new Set(outs.map(i=>String(i.id)));
 const active=roster.filter(p=>!unavailable.has(p.id)&&!outs.some(i=>i.name?.toLowerCase()===p.name.toLowerCase())&&teamGames.some(g=>g.players.some(x=>String(x.id)===p.id&&x.team===team&&x.min>0)));
 const recentTeamGames=games.filter(g=>g.home===team||g.away===team).slice(-5);
 const participation=p=>recentTeamGames.filter(g=>g.players.some(x=>String(x.id)===p.id&&x.team===team&&x.min>0)).length/Math.max(1,recentTeamGames.length);
 const result=new Map(active.map(p=>[p.id,{baselineMinutes:p.avg.min,recentMinutes:mean(p.lines.slice(-5),'min'),projectedMinutes:clamp((.7*mean(p.lines.slice(-5),'min')+.3*p.avg.min)*participation(p),0,38),rates:{pts:0,reb:0,ast:0},drivers:[],method:'Recent five games + season minutes',freshInjuries:fresh}]));
 if(fresh)for(const out of outs.filter(o=>o.status==='out')){
  const missing=roster.find(p=>p.id===String(out.id)||p.name.toLowerCase()===out.name.toLowerCase());
  if(!missing||missing.avg.min<18)continue;
  const presentShare=teamGames.filter(g=>g.players.some(x=>String(x.id)===missing.id&&x.min>=6)).length/Math.max(1,teamGames.length);
  // No new vacancy if the absence is already present throughout the recent rotation.
  if(!presentShare)continue;
  const weights=new Map(active.map(p=>[p.id,affinity(p.position,missing.position)*Math.max(0,38-result.get(p.id).projectedMinutes)*Math.sqrt(Math.max(1,result.get(p.id).projectedMinutes))]));
  const totalWeight=[...weights.values()].reduce((a,b)=>a+b,0)||1;
  for(const p of active){
   const o=result.get(p.id),before=o.projectedMinutes;
   const withPlayer=[],withoutPlayer=[];
   const eligibleGames=games.filter(g=>g.players.some(x=>String(x.id)===missing.id&&x.team===team));
   const first=eligibleGames[0]?.date,last=eligibleGames.at(-1)?.date;
   for(const line of p.lines){
    if(!first||line.date<first||line.date>last)continue; // do not call pre-arrival/post-trade games injury splits
    const g=games.find(g=>g.id===line.gameId);
    if(!g)continue;
    (g.players.some(x=>String(x.id)===missing.id&&x.min>=1)?withPlayer:withoutPlayer).push(line);
   }
   const observed=withPlayer.length>=3&&withoutPlayer.length>=3;
   let minuteChange=0;const changes={pts:0,reb:0,ast:0};
   if(observed){
    const reliability=Math.min(withPlayer.length,withoutPlayer.length)/(Math.min(withPlayer.length,withoutPlayer.length)+6);
    minuteChange=clamp((mean(withoutPlayer,'min')-mean(withPlayer,'min'))*reliability*presentShare,-5,6);
    for(const k of Object.keys(changes))if(rate(withPlayer,k)>.02)changes[k]=clamp((rate(withoutPlayer,k)/rate(withPlayer,k)-1)*reliability*presentShare,-.12,.15);
   }else{
    minuteChange=Math.min(6,missing.avg.min*.6*presentShare*weights.get(p.id)/totalWeight);
    // Role affinity + demonstrated shot creation determine who receives a vacancy estimate.
    const peers=active.reduce((s,a)=>s+a.avg.min*(.3+affinity(a.position,missing.position)),0)||1;
    const share=p.avg.min*(.3+affinity(p.position,missing.position))/peers;
    const useMissing=mean(missing.lines.slice(-5),'fga')+.44*mean(missing.lines.slice(-5),'fta');
    const usePlayer=mean(p.lines.slice(-5),'fga')+.44*mean(p.lines.slice(-5),'fta');
    changes.pts=useMissing>0&&usePlayer>2?clamp(useMissing*.35*share/ usePlayer*presentShare,0,.10):0;
    changes.ast=missing.avg.ast>=4&&p.avg.ast>=2?clamp(missing.avg.ast*.25*share/p.avg.ast*presentShare,0,.12):0;
    // Rebounds rise via minutes only unless comparable historical splits support a rate change.
   }
   o.projectedMinutes=clamp(o.projectedMinutes+minuteChange,0,Math.min(38,o.recentMinutes+8));
   for(const k of Object.keys(changes))o.rates[k]=clamp(o.rates[k]+changes[k],-.15,.18);
   if(Math.abs(o.projectedMinutes-before)>=.3||Object.values(changes).some(v=>Math.abs(v)>=.02))o.drivers.push({name:missing.name,method:observed?'Observed with/without splits':'Estimated role redistribution',minuteChange:Math.round((o.projectedMinutes-before)*10)/10,rates:changes,withGames:withPlayer.length,withoutGames:withoutPlayer.length});
  }
 }
 // A regulation team has 240 minutes; never allocate more across this active rotation.
 const total=[...result.values()].reduce((s,o)=>s+o.projectedMinutes,0);
 if(total>240)for(const o of result.values()){o.projectedMinutes*=240/total;o.budgetAdjusted=true;}
 return result;
}
function combineProjection(player,stat,environment,opportunity,weights){
 const base=player.avg[stat],o=opportunity;
 const minuteRatio=o.projectedMinutes/Math.max(1,player.avg.min);
 const recent=rate(player.lines.slice(-5),stat),season=rate(player.lines,stat);
 const form=season>0?clamp(recent/season-1,-.5,.5)*(weights?.recent??.2):0;
 const minuteValue=base*minuteRatio;
 const formValue=minuteValue*(1+form);
 const injuryValue=formValue*(1+o.rates[stat]);
 const projected=clamp(injuryValue*(1+environment.matchup),base*.45,base*1.65);
 return {projection:projected,total:base>0?projected/base-1:0,components:{minutes:minuteValue-base,form:formValue-minuteValue,injury:injuryValue-formValue,matchup:projected-injuryValue}};
}
module.exports={buildOpportunity,combineProjection};
