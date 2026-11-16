'use strict';

// Matchup projection features and conservative, per-stat model calibration.
// Both the live scanner and the chronological backtester call this exact formula.
const STATS=['pts','reb','ast'];
const DEFAULT={recent:0.20,role:0.72,position:0.26,pace:0.55};
const LIMITS={recent:[0,0.65],role:[0,1.30],position:[0,1.10],pace:[0,1.30]};
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,Number.isFinite(n)?n:0));
const safe=(n)=>Number.isFinite(Number(n))?Number(n):0;
function cleanWeights(w={}){
  return Object.fromEntries(Object.keys(DEFAULT).map(k=>[k,clamp(safe(w[k]??DEFAULT[k]),...LIMITS[k])]));
}
function defaultModel(){return {pts:{...DEFAULT},reb:{...DEFAULT},ast:{...DEFAULT}};}
function projection(base,features={},weights=DEFAULT,injury=0){
  const w=cleanWeights(weights);
  const components={};
  for(const k of Object.keys(DEFAULT))components[k]=safe(features[k])*w[k];
  const matchup=components.role+components.position+components.pace+safe(injury);
  const total=clamp(matchup+components.recent,-.35,.35);
  return {projection:Math.max(0,safe(base)*(1+total)),matchup:clamp(matchup,-.35,.35),total,components};
}
const mae=(rows,stat,weights,mode='model')=>{
  if(!rows.length)return null;
  let error=0;
  for(const r of rows){const x=r[stat]; if(!x)continue; const predicted=mode==='baseline'?x.base:projection(x.base,x.features,weights).projection;error+=Math.abs(predicted-x.actual);}
  return error/rows.length;
};
function measure(rows,stat,weights=DEFAULT){
  if(!rows.length)return null;
  let abs=0,sq=0,bias=0,baseline=0,up=0,upHit=0,down=0,downHit=0,strong=0,strongHit=0,coverage=0;
  for(const r of rows){
    const x=r[stat];if(!x)continue;
    const p=projection(x.base,x.features,weights);
    const err=p.projection-x.actual;
    abs+=Math.abs(err);sq+=err*err;bias+=err;baseline+=Math.abs(x.base-x.actual);
    if(Math.abs(p.matchup)>=.10){
      const hit=p.matchup>0?x.actual>x.base:x.actual<x.base;
      if(p.matchup>0){up++;upHit+=+hit;}else{down++;downHit+=+hit;}
      if(Math.abs(p.matchup)>=.17){strong++;strongHit+=+hit;}
    }
    if(x.actual>=0)coverage++;
  }
  if(!coverage)return null;
  return {n:coverage,mae:abs/coverage,rmse:Math.sqrt(sq/coverage),bias:bias/coverage,baselineMAE:baseline/coverage,maeImprovementPct:baseline?100*(baseline-abs)/baseline:0,positive:{n:up,hits:upHit,rate:up?upHit/up:null},negative:{n:down,hits:downHit,rate:down?downHit/down:null},strong:{n:strong,hits:strongHit,rate:strong?strongHit/strong:null}};
}
function tuneStat(rows,stat){
  // All optimization happens only on the TRAINING split. Never use held-out errors to pick coefficients.
  const fallback=DEFAULT;
  if(rows.length<80)return {weights:{...fallback},training:measure(rows,stat,fallback),calibrated:false,reason:'At least 80 prior player-games required for training'};
  const grids={recent:[0,.15,.3,.5],role:[0,.35,.7,1,1.3],position:[0,.25,.55,.85],pace:[0,.35,.7,1.1]};
  const baselineMAE=mae(rows,stat,fallback);
  let best={...fallback},bestScore=baselineMAE;
  for(const recent of grids.recent)for(const role of grids.role)for(const position of grids.position)for(const pace of grids.pace){
    const w={recent,role,position,pace};
    const err=mae(rows,stat,w);
    // Light regularization: favour a simpler model unless accuracy actually improves.
    const score=err+0.002*(recent+role+position+pace);
    if(score<bestScore-1e-9){bestScore=score;best=w;}
  }
  const bestMAE=mae(rows,stat,best);
  const calibrated=(baselineMAE-bestMAE)>=Math.max(.003,baselineMAE*.002);
  const weights=calibrated?best:{...fallback};
  return {weights,training:measure(rows,stat,weights),calibrated,reason:calibrated?'Selected using chronological training observations only':'No material training improvement over conservative default weights'};
}
function tune(rows){const result={};for(const stat of STATS)result[stat]=tuneStat(rows,stat);return result;}
module.exports={STATS,DEFAULT,defaultModel,clamp,cleanWeights,projection,mae,measure,tune,tuneStat};
