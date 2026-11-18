'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('Multi builder accepts started games, preserves selections on refresh and keeps legs across dates',async()=>{
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',querySelectorAll:()=>[]});return elements.get(id);};
 const games=[{id:'one',date:'2020-01-01T00:00Z',home:'BOS',away:'NYK',completed:false},{id:'two',date:'2020-01-02T00:00Z',home:'BOS',away:'NYK',completed:false}];
 const feed={games:{},fixtures:games,players:[{id:'p',name:'Player',team:'BOS'}],updatedAt:new Date().toISOString()};let stored='[]';
 const context={window:{BetEngine:require('../public/bet-engine')},document:{getElementById:el},localStorage:{getItem:()=>stored,setItem:(_,v)=>stored=v},fetch:async()=>({ok:true,json:async()=>feed}),crypto:{randomUUID:()=> 'bet'},setInterval:()=>{},setTimeout:()=>{},Intl,Date,console};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/bets.js'),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 el('bet-date').value='2020-01-01';el('bet-date').onchange();el('bet-game').value='one';el('bet-game').onchange();el('bet-player').value='p';el('bet-line').value='20';el('bet-stat').value='pts';el('bet-op').value='gte';el('bet-type').value='single';
 el('bet-add-leg').onclick();assert.match(el('bet-legs').innerHTML,/at least 20 PTS/);
 await el('bet-check').onclick();assert.equal(el('bet-game').value,'one');assert.equal(el('bet-player').value,'p');
 el('bet-date').value='2020-01-02';el('bet-date').onchange();el('bet-game').value='two';el('bet-game').onchange();el('bet-player').value='p';el('bet-line').value='5';el('bet-stat').value='ast';el('bet-add-leg').onclick();
 assert.equal(el('bet-type').value,'multi');assert.match(el('bet-legs').innerHTML,/20 PTS/);assert.match(el('bet-legs').innerHTML,/5 AST/);assert.match(el('bet-leg-message').textContent,/Leg 2 added/);
 el('bet-add-leg').onclick();assert.match(el('bet-leg-message').textContent,/already added/);
 el('bet-description').value='Already placed multi';el('bet-mode').value='auto';el('bet-odds').value='3';el('bet-stake').value='1';el('bet-form').onsubmit({preventDefault(){}});
 const saved=JSON.parse(stored);assert.equal(saved.length,1);assert.equal(saved[0].legs.length,2);assert.equal(saved[0].legs[0].gameId,'one');assert.equal(saved[0].legs[1].gameId,'two');
});
