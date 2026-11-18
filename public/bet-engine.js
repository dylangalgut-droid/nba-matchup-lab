(function(root){
'use strict';
const STAT_PARTS={'pts':['pts'],'reb':['reb'],'ast':['ast'],'pts+ast':['pts','ast'],'pts+reb':['pts','reb'],'reb+ast':['reb','ast']};
const round=n=>Math.round((n+Number.EPSILON)*10000)/10000;
function valid(b){return b&&typeof b.id==='string'&&typeof b.description==='string'&&b.description.trim().length>0&&b.description.length<=500&&/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&['single','multi'].includes(b.type)&&Number.isFinite(b.odds)&&b.odds>1&&b.odds<=100000&&Number.isFinite(b.stake)&&b.stake>0&&b.stake<=100000&&Array.isArray(b.legs)&&b.legs.length<=30&&b.legs.every(l=>l&&typeof l.gameId==='string'&&typeof l.playerId==='string'&&Object.hasOwn(STAT_PARTS,l.stat)&&['gte','over','under'].includes(l.op)&&Number.isFinite(l.line)&&l.line>=0&&l.line<=200)&&(!b.manual||(['won','lost','void','pending'].includes(b.manual.status)&&Number.isFinite(b.manual.profit)&&b.manual.profit>=-b.stake&&b.manual.profit<=1e10));}
function legResult(l,games){
 const g=games[l.gameId];if(!g||!g.completed)return {status:'pending',note:'Waiting for final box score'};
 const p=g.players.find(p=>String(p.id)===l.playerId);
 if(!p||!(p.min>0))return {status:'review',note:'No playing minutes: check bookmaker DNP rules'};
 const parts=Object.hasOwn(STAT_PARTS,l.stat)?STAT_PARTS[l.stat]:null;
 if(!parts||!parts.every(k=>Number.isFinite(p[k])))return {status:'review',note:'Stat unavailable'};
 const value=parts.reduce((total,k)=>total+p[k],0);
 if(l.op!=='gte'&&value===l.line)return {status:'review',value,note:'Push: check bookmaker settlement'};
 const won=l.op==='gte'?value>=l.line:l.op==='over'?value>l.line:value<l.line;
 return {status:won?'won':'lost',value,note:`Final ${l.stat.toUpperCase()}: ${value}`};
}
function settle(b,games){
 if(b.manual)return {...b.manual,source:'Manual',legs:[]};
 if(!b.legs.length)return {status:'review',profit:0,source:'Manual settlement needed',legs:[]};
 const legs=b.legs.map(l=>legResult(l,games));
 // Do not guess how a bookmaker reprices a multi with a void or push.
 const status=legs.some(l=>l.status==='review')?'review':legs.some(l=>l.status==='lost')?'lost':legs.every(l=>l.status==='won')?'won':'pending';
 return {status,profit:status==='won'?round(b.stake*(b.odds-1)):status==='lost'?-b.stake:0,source:'Final box scores',legs};
}
function totals(bets,results,date){
 const list=bets.filter(b=>!date||b.date===date);const out={profit:0,won:0,lost:0,void:0,pending:0,review:0,staked:0};
 for(const b of list){const r=results[b.id];out[r.status]++;out.profit+=r.profit;out.staked+=b.stake;}
 out.profit=round(out.profit);return out;
}
const api={valid,legResult,settle,totals};if(typeof module==='object')module.exports=api;else root.BetEngine=api;
})(typeof window==='object'?window:globalThis);
