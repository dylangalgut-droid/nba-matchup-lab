'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildOpportunity,combineProjection}=require('../opportunity');
const {buildAnalysis}=require('../analysis');
const make=(id,min,pts=12)=>({id,name:id,team:'BOS',position:'G',n:10,lastPlayed:'2026-11-10T00:00:00Z',avg:{min,pts,reb:3,ast:3},lines:Array.from({length:10},(_,i)=>({gameId:String(i),date:`2026-11-${String(i+1).padStart(2,'0')}T00:00:00Z`,team:'BOS',min,pts,reb:3,ast:3,fga:12,fta:2}))});
function fixture(){const players=[make('star',34,26),make('backup',15,8),make('starter',35,20)];const games=Array.from({length:10},(_,i)=>({id:String(i),date:players[0].lines[i].date,home:'BOS',away:'NYK',completed:true,players:players.map(p=>({...p.lines[i],id:p.id,name:p.name,position:'G',opponent:'NYK'}))}));return {players,games,outs:[{id:'star',name:'star',team:'BOS',status:'out'}]};}
test('New major absence benefits a rotation replacement more than a heavy-minute starter',()=>{const {players,games,outs}=fixture();const o=buildOpportunity(players,'BOS',outs,games,{fresh:true,gameDate:'2026-11-11'});assert(!o.has('star'));assert(o.get('backup').projectedMinutes-15>o.get('starter').projectedMinutes-35);assert(o.get('backup').drivers.some(d=>d.method==='Estimated role redistribution'));assert([...o.values()].reduce((s,x)=>s+x.projectedMinutes,0)<=240);});
test('Long-standing absence and stale injury feed do not add new injury opportunity',()=>{const {players,games,outs}=fixture();for(const g of games.slice(-3))g.players=g.players.filter(p=>p.id!=='star');const o=buildOpportunity(players,'BOS',outs,games,{fresh:true,gameDate:'2026-11-11'});assert.equal(o.get('backup').projectedMinutes,15);assert.equal(o.get('backup').rates.pts,0);const stale=buildOpportunity(players,'BOS',outs,fixture().games,{fresh:false,gameDate:'2026-11-11'});assert.equal(stale.get('backup').projectedMinutes,15);assert.equal(stale.get('backup').drivers.length,0);});
test('Three with and without games use observed splits rather than invented usage',()=>{const {players,games,outs}=fixture();for(const i of [2,3,4]){games[i].players=games[i].players.filter(p=>p.id!=='star');players[1].lines[i].min=25;players[1].lines[i].pts=20;}const o=buildOpportunity(players,'BOS',outs,games,{fresh:true,gameDate:'2026-11-11'});const d=o.get('backup').drivers[0];assert.equal(d.method,'Observed with/without splits');assert.equal(d.withoutGames,3);assert.equal(d.withGames,7);assert(o.get('backup').rates.pts>0);});
test('Reduced minutes can outweigh favourable defensive averages',()=>{const p=make('guard',30,20);const o={projectedMinutes:20,rates:{pts:0}};const r=combineProjection(p,'pts',{matchup:.1},o,{recent:0});assert(r.projection<20);assert(r.total<0);assert(Math.abs(Object.values(r.components).reduce((a,b)=>a+b,0)-(r.projection-20))<1e-8);});
test('Injury alone can produce a player-specific favourable signal against neutral defence',()=>{const {games,outs}=fixture();const w={pts:{recent:0,role:0,position:0,pace:0},reb:{recent:0,role:0,position:0,pace:0},ast:{recent:0,role:0,position:0,pace:0}};const next=[{id:'next',date:'2026-11-11T00:00:00Z',home:'BOS',away:'NYK'}];const info={available:true,fetchedAt:'2026-11-10T12:00:00Z',records:outs};const d=buildAnalysis(games,next,info,{asOf:'2026-11-10T13:00:00Z',model:w});const p=d.matches[0].players.find(p=>p.id==='backup');assert(p);assert(['positive','strong-positive'].includes(p.stats.pts.level));assert.equal(p.stats.pts.defenseEdge,0);assert(p.context.projectedMinutes>15);});
test('Heatmap is an additive raw allowance difference, not a percent or a projection',()=>{const {games}=fixture();const d=buildAnalysis(games);const r=d.teamData.NYK.find(x=>x.role==='All Gs');assert.equal(r.delta.pts,Math.round((r.pts-r.league.pts)*10)/10);assert.equal(r.delta.pts,0);});

test("Occasional bench appearances do not steal full rotation minutes",()=>{const {players,games}=fixture();const fringe=make("fringe",25);players.push(fringe);games[8].players.push({...fringe.lines[8],id:fringe.id,team:"BOS"});const o=buildOpportunity(players,"BOS",[],games);assert.equal(o.get("fringe").projectedMinutes,5);assert.equal(o.get("starter").projectedMinutes,35);});
test('Today and tomorrow remain visible, including finished games without new predictions',()=>{const {games}=fixture();const fixtures=[{id:'today',date:'2026-11-10T00:00Z',home:'BOS',away:'NYK',completed:true},{id:'tomorrow',date:'2026-11-11T00:00Z',home:'BOS',away:'NYK',completed:false}];const d=buildAnalysis(games,fixtures,{}, {includeCompleted:true});assert.deepEqual(d.matches.map(g=>g.id),['today','tomorrow']);assert.deepEqual(d.matches[0].players,[]);});

test('Heatmap roster includes unflagged bench players and labels injuries without changing signals',()=>{
 const {games,outs}=fixture();
 const d=buildAnalysis(games,[{id:'next',date:'2026-11-11T00:00:00Z',home:'BOS',away:'NYK'}],{records:outs});
 const roster=d.matches[0].rolePlayers;
 assert(roster.some(p=>p.id==='backup'));
 assert.equal(roster.find(p=>p.id==='star').injury.status,'out');
 assert(roster.every(p=>p.position&&p.role));
 const final=buildAnalysis(games,[games[9]],{}, {includeCompleted:true}).matches[0];
 assert.equal(final.rolePlayersSource,'Final box score');assert.equal(final.players.length,0);assert.equal(final.rolePlayers.length,3);
});

test('Heatmap cell matches only opposition position and role independently of signal strength',()=>{
 const vm=require('node:vm'),fs=require('node:fs');const ctx=vm.createContext({});
 vm.runInContext(fs.readFileSync(require.resolve('../public/app.js'),'utf8').split('(async()=>{bind();')[0],ctx);
 ctx.game={home:'BOS',away:'NYK',rolePlayers:[
 {id:'neutral',team:'NYK',position:'G',role:'Scoring guard'},
 {id:'other-role',team:'NYK',position:'G',role:'Pass-first guard'},
 {id:'same-team',team:'BOS',position:'G',role:'Scoring guard'},
 {id:'other-position',team:'NYK',position:'F',role:'Scoring forward'}]};
 assert.equal(vm.runInContext("heatmapPlayers(game,'BOS','G','Scoring guard').map(p=>p.id).join(',')",ctx),'neutral');
 assert.equal(vm.runInContext("heatmapPlayers(game,'BOS','G','All Gs').length",ctx),2);
 assert.equal(vm.runInContext("heatmapPlayers(game,'NYK','G','Scoring guard')[0].id",ctx),'same-team');
});

test('Minutes volatility is damped and capped while matchup and injury usage retain full influence',()=>{
 const p=make('guard',30,20);
 const estimate=min=>({projectedMinutes:min,rates:{pts:.1}});
 const r=combineProjection(p,'pts',{matchup:.1},estimate(36),{recent:0});
 assert(Math.abs(r.components.minutes-2.4)<1e-9); // 20% extra minutes becomes 12% output
 assert(Math.abs(r.components.injury-2.24)<1e-9); // full 10% usage change
 assert(Math.abs(r.components.matchup-2.464)<1e-9); // full 10% matchup change
 const high=combineProjection(p,'pts',{matchup:0},estimate(60),{recent:0});
 const low=combineProjection(p,'pts',{matchup:0},estimate(5),{recent:0});
 assert(Math.abs(high.components.minutes-4)<1e-9);
 assert(Math.abs(low.components.minutes+4)<1e-9);
 const flat=combineProjection(p,'pts',{matchup:0},{projectedMinutes:30,rates:{pts:0}},{recent:0});
 assert.equal(flat.projection,20);
});
