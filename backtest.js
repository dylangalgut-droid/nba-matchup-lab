'use strict';

// Strict walk-forward feature generation: game outcomes are never included in their own forecast.
// Model coefficients are fit to earlier prediction dates, then scored on untouched later dates.
const {buildAnalysis}=require('./analysis');
const {STATS,DEFAULT,defaultModel,tune,measure,projection}=require('./model');
const rounded=(n,d=2)=>n==null?null:Number(n.toFixed(d));
const MIN_WARMUP_DATES=9;
const MIN_WARMUP_GAMES=23;
const MIN_TRAIN=80;
const MIN_HOLDOUT=35;
function groupGames(games,startDate='0000-01-01'){
  const group=new Map();
  for(const g of games||[]){
    if(!g?.completed||!Array.isArray(g.players)||!g.players.length||!g.date||g.date.slice(0,10)<startDate)continue;
    if(g.seasonType!=null&&Number(g.seasonType)!==2)continue; // exclude preseason and postseason when identified
    const date=g.date.slice(0,10);
    if(!group.has(date))group.set(date,[]);
    group.get(date).push(g);
  }
  return [...group].sort(([a],[b])=>a.localeCompare(b));
}
function generateWalkForwardRows(games,{startDate='0000-01-01',minWarmupDates=MIN_WARMUP_DATES,minWarmupGames=MIN_WARMUP_GAMES}={}){
  const groups=groupGames(games,startDate);
  let past=[],results=[],forecastDates=0,unevaluated=0;
  for(let i=0;i<groups.length;i++){
    const [date,actualGames]=groups[i];
    if(i>=minWarmupDates&&past.length>=minWarmupGames){
      const next=actualGames.map(({id,date,home,away})=>({id,date,home,away,completed:false}));
      const scan=buildAnalysis(past,next,{available:false,records:[]},{startDate,includeNeutral:true,skipInjury:true});
      const indexed=new Map(actualGames.map(g=>[String(g.id),g]));
      for(const game of scan.matches){
        const played=indexed.get(String(game.id));if(!played)continue;
        const lines=new Map(played.players.map(p=>[`${String(p.id)}|${p.team}`,p]));
        for(const player of game.players){
          const observed=lines.get(`${player.id}|${player.team}`);
          if(!observed||observed.min<6)continue;
          const item={date,gameId:String(game.id),playerId:player.id,playerName:player.name,team:player.team,opponent:player.team===game.home?game.away:game.home,role:player.role};
          let good=true;
          for(const stat of STATS){
            const x=player.stats[stat];
            if(!x||!Number.isFinite(x.base)||!x.features||!Number.isFinite(observed[stat])){good=false;break;}
            item[stat]={base:x.base,features:x.features,actual:observed[stat]};
          }
          if(good)results.push(item);else unevaluated++;
        }
      }
      forecastDates++;
    }
    past=past.concat(actualGames);
  }
  return {rows:results,dates:forecastDates,completedGames:past.length,unevaluated,totalDates:groups.length};
}
function createBacktest(games,opts={}){
  const walking=generateWalkForwardRows(games,opts);
  const rows=walking.rows;
  const dates=[...new Set(rows.map(x=>x.date))].sort();
  const splitIndex=Math.max(1,Math.min(dates.length-1,Math.floor(dates.length*.7)));
  const splitDate=dates[splitIndex]||null;
  const train=splitDate?rows.filter(r=>r.date<splitDate):rows;
  const holdout=splitDate?rows.filter(r=>r.date>=splitDate):[];
  const sufficient=train.length>=MIN_TRAIN&&holdout.length>=MIN_HOLDOUT&&dates.length>=6;
  const tuned=sufficient?tune(train):Object.fromEntries(STATS.map(stat=>[stat,{weights:{...DEFAULT},calibrated:false,reason:'Insufficient chronological training or holdout games',training:measure(train,stat,DEFAULT)}]));
  const model=Object.fromEntries(STATS.map(stat=>[stat,tuned[stat].weights]));
  const metrics={};
  for(const stat of STATS){
    const w=model[stat];metrics[stat]={train:measure(train,stat,w),holdout:measure(holdout,stat,w),defaultHoldout:measure(holdout,stat,DEFAULT),weights:w,calibrated:tuned[stat].calibrated,reason:tuned[stat].reason};
  }
  const formatRows=r=>r.slice(-180).reverse().map(p=>({date:p.date,player:p.playerName,team:p.team,opponent:p.opponent,stats:Object.fromEntries(STATS.map(k=>[k,{actual:p[k].actual,baseline:rounded(p[k].base,1),predicted:rounded(projection(p[k].base,p[k].features,model[k]).projection,1),difference:rounded(projection(p[k].base,p[k].features,model[k]).projection-p[k].actual,1)}]))}));
  return {status:sufficient?'evaluated':'insufficient',builtAt:new Date().toISOString(),lastGameDate:dates.at(-1)||null,training:{n:train.length,dates:dates.slice(0,splitIndex).length,first:train[0]?.date||null,last:train.at(-1)?.date||null},holdout:{n:holdout.length,dates:Math.max(0,dates.length-splitIndex),first:holdout[0]?.date||null,last:holdout.at(-1)?.date||null},observations:rows.length,forecastDates:walking.dates,completedGames:walking.completedGames,notEvaluated:walking.unevaluated,models:metrics,selectedModel:model,examples:formatRows(holdout),notes:[
    'Every predicted game uses only previously completed game dates; same-day future outcomes are excluded.',
    'Weights are fitted to the earliest 70% of evaluated dates. Later dates are untouched until the final test score.',
    'Model error is evaluated only on players who actually appeared for at least six minutes. DNPs cannot be scored.',
    'This audit covers the original statistical model only. The live projected-minutes and injury opportunity overlay is NOT included in these accuracy figures; it remains unvalidated.',
    'Strong/positive labels are matchup-effect magnitudes, not calibrated betting probabilities.',
    sufficient?'The tuned model is used for the next-day scanner. Training and untouched holdout errors are displayed separately.':'Not enough independent history to verify tuned weights. Conservative defaults remain active until more games are synced.'
  ]};
}
module.exports={createBacktest,generateWalkForwardRows,groupGames};
