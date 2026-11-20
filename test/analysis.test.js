'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normTeam,roleFor,buildAnalysis,localDate,addDays,normalizeInjuries}=require('../analysis');
const {extractBox,eventFromESPN,parseInjuries}=require('../server');
const row=(id,name,team,opponent,position,pts,reb,ast)=>({id,name,team,opponent,position,pts,reb,ast,min:32,threeAtt:4});
test('Normalizes ESPN team naming aliases',()=>{
  assert.equal(normTeam('GS'),'GSW');assert.equal(normTeam('SA'),'SAS');assert.equal(normTeam('WSH'),'WAS');assert.equal(normTeam('NY'),'NYK');
});
test('Classifies pass-first PG, scoring wing and playmaking big from role not position only',()=>{
  assert.equal(roleFor({position:'PG',avg:{pts:16,ast:8}}),'Pass-first PG');
  assert.equal(roleFor({position:'SF',avg:{pts:21,ast:2}}),'Scoring wing');
  assert.equal(roleFor({position:'C',avg:{pts:18,ast:6}}),'Playmaking C');
});
test('Melbourne date and next-day calculation are timezone-aware',()=>{
  assert.equal(localDate(new Date('2026-11-16T12:00:00Z')),'2026-11-16');
  assert.equal(addDays('2026-11-16',1),'2026-11-17');
});
test('Parses ESPN game summary with actual boxscore labels, minutes and positions',()=>{
  const event={id:'123',date:'2026-11-15T22:00:00Z',home:'BOS',away:'GSW',completed:true};
  const result=extractBox({boxscore:{players:[
    {team:{abbreviation:'BOS'},statistics:[{labels:['MIN','FG','3PT','REB','AST','PTS'],athletes:[{athlete:{id:'4',displayName:'Example Center',position:{abbreviation:'C'}},stats:['31:30','8-14','2-5','12','5','24']},{athlete:{id:'2',displayName:'Example DNP',position:{abbreviation:'PG'}},didNotPlay:true,stats:['0','0-0','0-0','0','0','0']}]}]},
    {team:{abbreviation:'GS'},statistics:[{labels:['MIN','3PT','REB','AST','PTS'],athletes:[{athlete:{id:'8',displayName:'Example Guard',position:{abbreviation:'PG'}},stats:['34','3-9','5','11','21']}]}]}
  ]}},event);
  assert.equal(result.length,2);
  assert.equal(result[0].min,31.5);assert.equal(result[0].reb,12);assert.equal(result[0].threeAtt,5);assert.equal(result[0].tpm,2);assert.equal(result[1].tpm,3);
  assert.equal(result[1].team,'GSW');assert.equal(result[1].opponent,'BOS');assert.equal(result[1].ast,11);
});
test('Parses scoreboard, ESPN injuries, and out injury normalization',()=>{
  const e=eventFromESPN({id:'321',date:'2026-11-16T01:30:00Z',status:{type:{completed:true}},competitions:[{competitors:[{homeAway:'home',team:{abbreviation:'NY'}},{homeAway:'away',team:{abbreviation:'GS'}}]}]});
  assert.equal(e.home,'NYK');assert.equal(e.away,'GSW');assert.ok(e.completed);
  const injuries=parseInjuries({injuries:[{team:{abbreviation:'GS'},injuries:[{athlete:{id:'8',displayName:'Example Guard'},status:'INJURY_STATUS_OUT',shortComment:'Out'}]}]});
  assert.equal(injuries[0].team,'GSW');assert.equal(normalizeInjuries(injuries)[0].status,'out');
});
test('Generates per-role defensive allowed stats and excludes reported out matchup players',()=>{
  const games=[];
  for(let n=0;n<6;n++){
    games.push({id:String(n),date:`2026-11-${String(n+1).padStart(2,'0')}T20:00:00Z`,home:'BOS',away:'GSW',completed:true,players:[row('101','Sample Passer','BOS','GSW','PG',18,3,9),row('201','Sample Scorer','GSW','BOS','SG',24,3,2),row('102','Sample Big','BOS','GSW','C',10,12,1),row('202','Sample Center','GSW','BOS','C',16,10,3)]});
  }
  const next=[{id:'next',date:'2026-11-17T01:00:00Z',home:'GSW',away:'BOS',completed:false}];
  const without=buildAnalysis(games,next,{available:true,records:[]});
  const allowed=without.teamData.GSW.find(x=>x.role==='Pass-first PG');
  assert.equal(allowed.n,6);assert.equal(allowed.pts,18);assert.equal(allowed.ast,9);
  assert.equal(without.sample.games,6);
  assert.equal(without.matches.length,1);
  const withInjury=buildAnalysis(games,next,{available:true,records:[{team:'BOS',id:'101',name:'Sample Passer',status:'INJURY_STATUS_OUT'}]});
  assert.equal(withInjury.matches[0].players.some(x=>x.id==='101'),false);
});

test("ESPN broad position labels are retained without inventing specific positions",()=>{const {positionOf,roleFor}=require("../analysis"); assert.equal(positionOf("G"),"G"); assert.equal(positionOf("Forward"),"F"); assert.equal(roleFor({position:"G",avg:{ast:7,pts:20}}),"Pass-first guard"); assert.equal(roleFor({position:"F",avg:{ast:2,pts:22}}),"Scoring forward");});
