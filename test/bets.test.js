'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../public/bet-engine');
const leg={gameId:'g',playerId:'p',stat:'pts',op:'gte',line:20};
const bet={id:'b',date:'2026-11-18',description:'Player 20+',type:'single',odds:1.9,stake:2,legs:[leg]};
const games={g:{completed:true,players:[{id:'p',min:30,pts:20,reb:8,ast:5}]}};
test('20+ hits exactly 20 and net winnings exclude returned stake',()=>{const r=E.settle(bet,games);assert.equal(r.status,'won');assert.equal(r.profit,1.8);});
test('Over, under and losing stake settle correctly',()=>{assert.equal(E.settle({...bet,legs:[{...leg,op:'over',line:20.5}]},games).profit,-2);assert.equal(E.settle({...bet,legs:[{...leg,op:'under',line:20.5}]},games).status,'won');});
test('Pushes, DNP and absent players need bookmaker review',()=>{assert.equal(E.settle({...bet,legs:[{...leg,op:'over'}]},games).status,'review');assert.equal(E.settle(bet,{g:{completed:true,players:[]}}).status,'review');assert.equal(E.settle(bet,{g:{completed:true,players:[{id:'p',min:0,pts:0}]}}).status,'review');});
test('Live and missing box scores never settle automatically',()=>{assert.equal(E.settle(bet,{}).status,'pending');assert.equal(E.settle(bet,{g:{...games.g,completed:false}}).status,'pending');});
test('Multi is one bet; all legs must win and void legs require review',()=>{const m={...bet,type:'multi',odds:3,legs:[leg,{...leg,stat:'reb',line:8}]};assert.equal(E.settle(m,games).profit,4);assert.equal(E.settle({...m,legs:[leg,{...leg,stat:'reb',line:9}]},games).status,'lost');assert.equal(E.settle({...m,legs:[leg,{...leg,stat:'reb',line:8,op:'over'}]},games).status,'review');const t=E.totals([m],{b:E.settle(m,games)});assert.equal(t.won,1);});
test('Daily totals use bet date; pending and void have zero profit',()=>{const bets=[bet,{...bet,id:'c',date:'2026-11-19',manual:{status:'lost',profit:-2}},{...bet,id:'v',manual:{status:'void',profit:0}},{...bet,id:'p',legs:[{...leg,gameId:'unknown'}]}];const r=Object.fromEntries(bets.map(b=>[b.id,E.settle(b,games)]));assert.equal(E.totals(bets,r,'2026-11-18').profit,1.8);assert.equal(E.totals(bets,r).profit,-.2);assert.equal(E.totals(bets,r).pending,1);assert.equal(E.totals(bets,r).void,1);});
test('Manual return overrides automatic results and malformed backups fail validation',()=>{assert.equal(E.settle({...bet,manual:{status:'won',profit:.5}},games).profit,.5);assert(E.valid(bet));assert(!E.valid({...bet,odds:0}));assert(!E.valid({...bet,stake:-1}));assert(!E.valid({...bet,legs:[{...leg,stat:'oops'}]}));assert(!E.valid({...bet,manual:{status:'won',profit:NaN}}));});

test('Combined player markets validate and settle summed totals with exact thresholds',()=>{
 for(const [stat,total] of [['pts+ast',25],['pts+reb',28],['reb+ast',13]]){
  const b={...bet,legs:[{...leg,stat,line:total}]};assert(E.valid(b));
  const r=E.settle(b,games);assert.equal(r.status,'won');assert.equal(r.legs[0].value,total);assert.equal(r.profit,1.8);
  assert.equal(E.settle({...b,legs:[{...b.legs[0],line:total+.5}]},games).status,'lost');
  assert.equal(E.settle({...b,legs:[{...b.legs[0],op:'under',line:total+.5}]},games).status,'won');
  assert.equal(E.settle({...b,legs:[{...b.legs[0],op:'over'}]},games).status,'review');
 }
});
test('Combined markets require all components and final minutes, including in multis',()=>{
 const combined={...leg,stat:'pts+ast',line:25};
 assert.equal(E.legResult(combined,{g:{completed:true,players:[{id:'p',min:30,pts:25}]}}).status,'review');
 assert.equal(E.legResult(combined,{g:{...games.g,completed:false}}).status,'pending');
 assert.equal(E.legResult(combined,{g:{completed:true,players:[{id:'p',min:0,pts:20,ast:5}]}}).status,'review');
 assert.equal(E.settle({...bet,type:'multi',legs:[combined,{...leg,stat:'reb+ast',line:13}]},games).status,'won');
 assert(!E.valid({...bet,legs:[{...leg,stat:'toString'}]}));
});
test('Made threes validate and settle singles and multi legs without guessing missing data',()=>{
 const l={...leg,stat:'tpm',line:3};const b={...bet,legs:[l]};
 const final={g:{completed:true,players:[{id:'p',min:30,pts:20,tpm:3}]}};
 assert.equal(E.valid(b),true);assert.equal(E.settle(b,final).status,'won');
 assert.equal(E.legResult({...l,op:'over',line:2.5},final).status,'won');
 assert.equal(E.legResult({...l,op:'under',line:2.5},final).status,'lost');
 assert.equal(E.legResult({...l,op:'over'},final).status,'review');
 assert.equal(E.legResult(l,games).status,'review');
 assert.equal(E.settle({...b,type:'multi',legs:[l,leg]},final).status,'won');
 assert.equal(E.legResult(l,{g:{completed:true,players:[{id:'p',min:25,tpm:0}]}}).status,'lost');
});
test('H2H settles final winners, mixed multis, and safely handles missing or tied scores',()=>{
 const l={gameId:'g',stat:'h2h',team:'BOS'};const b={...bet,legs:[l]};
 const final={g:{...games.g,home:'BOS',away:'NYK',homeScore:112,awayScore:109}};
 assert.equal(E.valid(b),true);assert.equal(E.valid({...b,legs:[{...l,team:''}]}),false);
 assert.equal(E.settle(b,final).status,'won');assert.equal(E.settle({...b,legs:[{...l,team:'NYK'}]},final).status,'lost');
 assert.equal(E.settle({...b,type:'multi',legs:[l,leg]},final).status,'won');
 assert.equal(E.legResult(l,{g:{...final.g,completed:false}}).status,'pending');
 for(const fields of [{homeScore:null},{homeScore:109},{homeScore:-1}])assert.equal(E.legResult(l,{g:{...final.g,...fields}}).status,'review');
 assert.equal(E.legResult({...l,team:'LAL'},final).status,'review');
});
