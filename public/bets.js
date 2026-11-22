'use strict';
(()=>{
const KEY='nba-matchup-bets-v1',E=window.BetEngine,$=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=s=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s));
const units=n=>`${n>0?'+':''}${Number(n).toFixed(2)}u`;
let bets=[],feed={games:{},fixtures:[],players:[]},results={},draft=[],storageOK=true;
try{const saved=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(saved)||!saved.every(E.valid))throw Error('Invalid stored bet data');bets=saved;}catch(e){storageOK=false;$('bet-message').textContent='Saved bets could not be loaded. Export your stored data before making changes; storage may be blocked or damaged.';}
function save(next){if(!storageOK)throw Error('Browser storage unavailable. Existing data has not been overwritten.');localStorage.setItem(KEY,JSON.stringify(next));bets=next;}
function message(s){$('bet-message').textContent=s;$('bet-leg-message').textContent=s;}
function render(){
 results=Object.fromEntries(bets.map(b=>[b.id,E.settle(b,feed.games)]));
 const date=$('bet-view-date').value||day(Date.now());
 const today=E.totals(bets.filter(b=>!b.removed),results,date),all=E.totals(bets.filter(b=>!b.removed),results);
 $('bet-day-total').textContent=units(today.profit);$('bet-all-total').textContent=units(all.profit);
 $('bet-record').textContent=`${all.won}W – ${all.lost}L – ${all.void}V`;
 $('bet-open').textContent=`${all.pending} pending · ${all.review} review`;
 $('bet-day-record').textContent=`${today.won}W – ${today.lost}L – ${today.void}V · ${today.pending} pending · ${today.review} review`;
 const shown=bets.filter(b=>!b.removed).filter(b=>$('bet-history-scope').value==='all'||b.date===date).slice().reverse();
 $('bet-history').innerHTML=shown.map(b=>{const r=results[b.id];return `<article class="panel bet-entry"><div class="bet-entry-head"><div><strong>${esc(b.description)}</strong><p>${esc(b.date)} · ${b.type==='multi'?'Multi':'Single'} · Odds ${b.odds} · Stake ${b.stake}u</p></div><strong class="${r.profit>0?'up':r.profit<0?'down':''}">${units(r.profit)}</strong></div><p><strong>${esc(r.status.toUpperCase())}</strong> · ${esc(r.source)}</p>${b.legs.map((l,i)=>`<p>${esc(l.label)}${r.legs[i]?` — ${esc(r.legs[i].note)}`:''}</p>`).join('')}<label>Settle / correct result <select data-result="${esc(b.id)}"><option value="">Choose…</option><option value="auto">Use automatic result</option><option value="won">Won</option><option value="lost">Lost</option><option value="void">Void / refunded</option><option value="pending">Pending</option><option value="custom">Custom return (void leg / cash-out)</option></select></label><button type="button" data-remove-bet="${esc(b.id)}">Remove bet</button></article>`;}).join('')||'<div class="empty-panel">No bets recorded for this view.</div>';
 $('bet-history').querySelectorAll('[data-remove-bet]').forEach(button=>button.onclick=()=>{try{save(bets.map(b=>b.id===button.dataset.removeBet?{...b,removed:true}:b));render();message('Bet removed from totals. Use Restore removed bets to undo.');}catch(e){message(e.message);}});
 $('bet-history').querySelectorAll('[data-result]').forEach(s=>s.addEventListener('change',()=>{const b=bets.find(b=>b.id===s.dataset.result);let manual=null;const action=s.value;if(!action)return;if(action==='custom'){const raw=prompt('Total return in units INCLUDING the returned stake (for a partial refund, void-leg multi or cash-out):');if(raw===null){s.value='';return;}const returned=Number(raw);if(!raw.trim()||!Number.isFinite(returned)||returned<0||returned>1e10){message('Enter a valid total return.');s.value='';return;}manual={status:returned>b.stake?'won':returned<b.stake?'lost':'void',profit:returned-b.stake};}else if(action!=='auto')manual={status:action,profit:action==='won'?b.stake*(b.odds-1):action==='lost'?-b.stake:0};try{save(bets.map(x=>x.id===b.id?{...x,manual}:x));render();message('Result updated.');}catch(e){message(e.message);}}));
}
function gamesForDate(){return [...feed.fixtures,...Object.values(feed.games)].filter((g,i,a)=>day(g.date)===$('bet-date').value&&a.findIndex(x=>x.id===g.id)===i).sort((a,b)=>a.date.localeCompare(b.date));}
function games(){const selected=$('bet-game').value;const gs=gamesForDate();$('bet-game').innerHTML='<option value="">Choose game</option>'+gs.map(g=>`<option value="${esc(g.id)}">${esc(g.away)} @ ${esc(g.home)}</option>`).join('');if(gs.some(g=>g.id===selected))$('bet-game').value=selected;players();}
function players(){const selected=$('bet-player').value;const g=gamesForDate().find(g=>g.id===$('bet-game').value);const ps=g?feed.players.filter(p=>p.team===g.home||p.team===g.away):[];$('bet-player').innerHTML='<option value="">Choose player</option>'+ps.sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.team)})</option>`).join('');if(ps.some(p=>p.id===selected))$('bet-player').value=selected;const team=$('bet-team').value;$('bet-team').innerHTML='<option value="">Choose team</option>'+(g?[g.away,g.home].map(t=>`<option value="${esc(t)}">${esc(t)} to win</option>`).join(''):'');$('bet-team').value=g&&[g.home,g.away].includes(team)?team:'';}
function showDraft(){$('bet-legs').innerHTML=draft.map((l,i)=>`<li>${esc(l.label)} <button type="button" data-remove="${i}" aria-label="Remove leg ${i+1}">Remove</button></li>`).join('');$('bet-legs').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{draft.splice(Number(b.dataset.remove),1);showDraft();});}
$('bet-date').value=$('bet-view-date').value=day(Date.now());
$('bet-date').onchange=()=>{games();message('Game list updated. Your added legs have been kept.');};$('bet-game').onchange=players;
function market(){const h=$('bet-stat').value==='h2h';$('bet-team-field').hidden=!h;for(const id of ['bet-player-field','bet-op-field','bet-line-field'])$(id).hidden=h;}
$('bet-stat').onchange=market;market();
$('bet-add-leg').onclick=()=>{const g=gamesForDate().find(g=>g.id===$('bet-game').value),p=feed.players.find(p=>p.id===$('bet-player').value),raw=$('bet-line').value,line=Number(raw),stat=$('bet-stat').value,op=$('bet-op').value;
 if(stat==='h2h'){
  const team=$('bet-team').value;
  if(!g||![g.home,g.away].includes(team)){message('Choose a game and the team to win.');return;}
  if(draft.length>=30){message('Maximum 30 legs.');return;}
  if(draft.some(l=>l.gameId===g.id&&l.stat==='h2h')){message('A head-to-head leg for this game is already added.');return;}
  draft.push({gameId:g.id,stat:'h2h',team,label:`${team} to win (including overtime) · ${g.away} @ ${g.home}`});
  if(draft.length>1)$('bet-type').value='multi';showDraft();message(`Leg ${draft.length} added. Choose another market or Save bet.`);return;
 }
 if(!g||!p||!raw||!Number.isFinite(line)||line<0||line>200){message('Choose a game, player and valid stat target.');return;}
 if(draft.length>=30){message('Maximum 30 legs.');return;}
 if(draft.some(l=>l.gameId===g.id&&l.playerId===p.id&&l.stat===stat&&l.op===op&&l.line===line)){message('That leg is already added.');return;}
 draft.push({gameId:g.id,playerId:p.id,stat,op,line,label:`${p.name} ${op==='gte'?'at least':op==='over'?'over':'under'} ${line} ${(stat==='tpm'?'made threes':stat.toUpperCase())} · ${g.away} @ ${g.home}`});if(draft.length>1)$('bet-type').value='multi';showDraft();message(`Leg ${draft.length} added. Choose the next player/stat and click Add leg again, or Save bet when finished.`);};
$('bet-form').onsubmit=e=>{e.preventDefault();try{const type=$('bet-type').value,mode=$('bet-mode').value,legs=mode==='auto'?draft.slice():[];
 if(mode==='auto'&&(legs.length<(type==='multi'?2:1)||(type==='single'&&legs.length!==1)))throw Error(type==='multi'?'Add at least two legs for a multi.':'Add exactly one leg for a single.');
 const b={id:crypto.randomUUID(),description:$('bet-description').value.trim(),type,date:$('bet-date').value,odds:Number($('bet-odds').value),stake:Number($('bet-stake').value),legs,createdAt:new Date().toISOString(),manual:null};
 if(!E.valid(b))throw Error('Check the description, decimal odds (above 1) and positive unit stake.');save([...bets,b]);draft=[];showDraft();$('bet-description').value='';$('bet-odds').value='';$('bet-stake').value='';render();message('Bet saved on this browser. Export a backup to keep a separate copy.');}catch(e){message(e.message);}};
$('bet-mode').onchange=()=>{$('bet-leg-builder').hidden=$('bet-mode').value!=='auto';};
$('bet-view-date').onchange=render;$('bet-history-scope').onchange=render;
$('bet-export').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,bets},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`nba-bets-${day(Date.now())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('bet-import').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>5e6)throw Error('Backup is too large.');const parsed=JSON.parse(await file.text()),incoming=parsed.bets;if(parsed.version!==1||!Array.isArray(incoming)||incoming.length>10000||!incoming.every(E.valid))throw Error('This is not a valid bet backup.');const map=new Map(bets.map(b=>[b.id,b]));let count=0;for(const b of incoming)if(!map.has(b.id)){map.set(b.id,b);count++;}save([...map.values()]);render();message(`Imported ${count} bets. Existing bets were preserved.`);}catch(e){message(e.message);}e.target.value='';};
async function refresh(){try{const r=await fetch('./data/settlements.json',{cache:'no-store'});if(!r.ok)throw Error('Result feed unavailable');const next=await r.json();if(!next.games||!Array.isArray(next.players)||!Array.isArray(next.fixtures))throw Error('Invalid result feed');feed=next;$('bet-feed').textContent=`Results updated ${new Date(feed.updatedAt).toLocaleString('en-AU',{timeZone:'Australia/Melbourne'})} Melbourne time. Final box scores only.`;games();render();}catch(e){$('bet-feed').textContent='Could not load result feed. Automatic bets remain pending; retry later.';render();}}
$('bet-restore').onclick=()=>{try{save(bets.map(b=>({...b,removed:false})));render();message('Removed bets restored.');}catch(e){message(e.message);}};
$('bet-check').onclick=refresh;render();refresh();setInterval(refresh,300000);
})();
