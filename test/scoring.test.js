'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const S=require('../scoring');
test('Shot zones are exclusive, with free throws and invalid coordinates rejected',()=>{
 const z=(x,y,v=2)=>S.zone({coordinate:{x,y},pointsAttempted:v});
 assert.equal(z(25,0),'rim');assert.equal(z(25,8),'paint');assert.equal(z(40,16),'mid');assert.equal(z(2,3,3),'corner');assert.equal(z(25,25,3),'arc');assert.equal(z(-214748340,0),null);assert.equal(z(25,15,1),null);
});
function fixture(){return {header:{competitions:[{competitors:[{team:{id:'1',abbreviation:'BOS'}}]}]},plays:[{id:'1',shootingPlay:true,pointsAttempted:3,scoreValue:3,team:{id:'1'},participants:[{athlete:{id:'p'}}],coordinate:{x:2,y:3}}],boxscore:{players:[{team:{abbreviation:'BOS'},statistics:[{labels:['FG','3PT'],athletes:[{athlete:{id:'p'},stats:['1-1','1-1']}]}]}]}};}
test('Import reconciles shooter attempts and makes, rejects incomplete games and deduplicates plays',()=>{
 const s=fixture(),g={id:'g',date:'2026-11-01',home:'BOS',away:'NYK'};s.plays.push({...s.plays[0]});const parsed=S.parse(s,g);assert.equal(parsed.shots.length,1);s.boxscore.players[0].statistics[0].athletes[0].stats=['1-2','1-2'];assert.throws(()=>S.parse(s,g),/reconcile/);
});
test('Team-only heaves count in zone totals but not player attempts',()=>{
 const s=fixture();s.plays.push({...s.plays[0],id:'2',scoreValue:0,type:{id:'282'},coordinate:{x:25,y:40}});const g=S.parse(s,{id:'g',home:'BOS',away:'NYK'});const a=S.aggregate([g]);assert.equal(a.teams.BOS.off.arc.a,1);assert.equal(a.players['BOS|p'].z.arc.a,0);assert.equal(a.teams.NYK.def.corner.p,3);
});
test('Shot adjustment is absent without evidence and removes broad defensive efficiency',()=>{
 assert.deepEqual(S.adjustment(S.aggregate([]),'p','BOS','NYK'),{pts:0,tpm:0,drivers:[]});
 const s=fixture(),g=S.parse(s,{id:'g',home:'BOS',away:'NYK'});const a=S.aggregate(Array.from({length:10},()=>g));assert.equal(S.adjustment(a,'p','BOS','NYK').pts,0);
});
