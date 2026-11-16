'use strict';
const $=id=>document.getElementById(id);
const state={page:'defence',team:'BOS',stat:'pts',position:'ALL',role:'Pass-first guard',matchFilter:'all',gameFilter:'ALL',data:null,status:null,audit:null};
const LABEL={pts:'points',reb:'rebounds',ast:'assists'};
const SAFE=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number.isFinite(Number(n))?Number(n).toFixed(1):'—';
const shortDate=s=>s?new Date(`${s}T12:00:00Z`).toLocaleDateString('en-AU',{day:'numeric',month:'short',timeZone:'UTC'}):'—';
const longDate=s=>s?new Date(`${s}T12:00:00Z`).toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}):'Tomorrow';
const melTime=s=>s?new Date(s).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',timeZone:'Australia/Melbourne'}):'TBC';
function setPage(page){
  state.page=page;
  document.querySelectorAll('.page').forEach(e=>e.classList.toggle('hidden',e.id!==`page-${page}`));
  document.querySelectorAll('.nav-link').forEach(e=>e.classList.toggle('active',e.dataset.page===page));
  $('crumb-page').textContent=page==='defence'?'Defence by role':page==='matchups'?'Next-day matchups':'Model performance';
  if(page==='performance')loadAudit();
  render();window.scrollTo({top:0,behavior:'smooth'});
}
function render(){if(state.page==='defence')renderDefence();else if(state.page==='matchups')renderMatchups();else renderPerformance();}
function renderMeta(){
  const d=state.data||{};const s=d.sample||{};
  $('metric-teams').innerHTML=`${d.teams?.length||30} <span>NBA</span>`;
  $('metric-games').innerHTML=`${s.games||'—'} <span>final</span>`;
  $('metric-players').innerHTML=`${s.players||'—'} <span>tracked</span>`;
  $('metric-window').textContent=s.first?`${shortDate(s.first)} — ${shortDate(s.last)}`:'Awaiting first sync';
  $('tomorrow-date').textContent=longDate(d.targetDate);
  $('nav-count').textContent=d.matches?.length||0;
  $('stat-slate').textContent=d.matches?.length||0;
  $('stat-strong').textContent=d.highlights?.filter(p=>p.major).length||0;
  $('stat-edges').textContent=d.highlights?.filter(p=>!p.major).length||0;
  $('stat-injuries').textContent=d.injuries?.available?`${d.injuries.count} reported statuses`:'Feed unavailable';
  $('footer-update').textContent=d.lastUpdated?`Last sync: ${new Date(d.lastUpdated).toLocaleString('en-AU',{timeZone:'Australia/Melbourne'})} AEDT/AEST`:'Not yet synced';
  $('live-pill').className=`live-pill ${d.lastUpdated?'synced':''}`;
  const cov=d.coverage;
  if(cov){$('coverage-footer').textContent=cov.expected?`${cov.imported} / ${cov.expected} completed game box scores imported · ${cov.missing} missing`:'No completed games found in imported scoreboards yet';}
  if(cov && cov.expected){$('footer-update').title=`${cov.imported}/${cov.expected} completed box scores imported${cov.missing?` · ${cov.missing} missing`:''}`;}
  $('live-pill').innerHTML=`<span></span>${d.lastUpdated?'DATA SYNCED':'NOT SYNCED'}`;
}
function renderTeams(){
  const q=$('team-search').value.trim().toLowerCase();
  const list=(state.data?.teams||[]).filter(t=>t.name.toLowerCase().includes(q)||t.abbr.toLowerCase().includes(q));
  $('teams-list').innerHTML=list.map(t=>`<button class="team-row ${state.team===t.abbr?'active':''}" type="button" data-team="${SAFE(t.abbr)}" role="option" aria-selected="${state.team===t.abbr}"><span class="team-abbr">${SAFE(t.abbr)}</span><span>${SAFE(t.name.replace(/^Los Angeles /,'LA ').replace(/^New York /,'NY ').replace(/^Golden State /,'GS '))}</span></button>`).join('')||'<div class="empty-panel">No matching teams</div>';
  $('teams-list').querySelectorAll('[data-team]').forEach(b=>b.addEventListener('click',()=>{state.team=b.dataset.team;renderDefence();}));
}
function deltaHtml(value,observations){
  if(!observations||observations<5)return '<span class="delta flat" title="Not enough observations">LOW N</span>';
  const cls=value>=5?'up':value<=-5?'down':'flat';
  return `<span class="delta ${cls}">${value>0?'+':''}${fmt(value)}%</span>`;
}
function renderDefence(){
  const d=state.data;if(!d)return;
  renderTeams();
  const team=d.teams.find(t=>t.abbr===state.team)||d.teams[0];
  if(team){$('selected-team-label').textContent=team.name;$('selected-team-games').textContent=`${team.games} games`}
  const rows=(d.teamData[state.team]||[]).filter(r=>state.position==='ALL'||r.position===state.position);
  $('allow-body').innerHTML=rows.map(r=>{
    const cls=k=>k===state.stat?'is-focused':'';
    const value=k=>r.n?fmt(r[k]):'—';
    return `<tr><td><span class="role-pos">${SAFE(r.position)}</span>${SAFE(r.role)}</td>${['pts','reb','ast'].map(k=>`<td class="numeric ${cls(k)} ${!r.n?'muted-value':''}">${value(k)}</td>`).join('')}<td class="numeric">${deltaHtml(r.vs[state.stat],r.n)}</td><td class="numeric ${!r.n?'muted-value':''}">${r.n||'—'}</td></tr>`;
  }).join('')||'<tr><td colspan="6">No roles available</td></tr>';
  const roles=d.roles||[];
  const select=$('role-filter');
  if(!select.options.length){select.innerHTML=roles.map(r=>`<option value="${SAFE(r.role)}">${SAFE(r.position)} · ${SAFE(r.role)}</option>`).join('');}
  if(!roles.some(r=>r.role===state.role))state.role=roles[0]?.role||'';
  select.value=state.role;
  const role=roles.find(r=>r.role===state.role);
  const filtered=(d.teams||[]).map(t=>{
    const a=(d.teamData[t.abbr]||[]).find(x=>x.role===state.role);
    return {...t,sample:a?.n||0,value:a?.[state.stat]||0};
  }).filter(x=>x.sample>=3).sort((a,b)=>b.value-a.value);
  const high=filtered[0]?.value||1;
  $('rank-stat-label').textContent=LABEL[state.stat];
  $('leaderboard-context').textContent=`${role?.position||''} · ${filtered.length} teams with data`;
  $('rank-grid').innerHTML=filtered.length?filtered.map((r,i)=>`<div class="rank-row" title="${SAFE(r.name)}: ${r.sample} opponent player-games"><span class="rank-num">${String(i+1).padStart(2,'0')}</span><span class="rank-team">${SAFE(r.abbr)}</span><div class="rank-bar"><div class="rank-fill" style="width:${Math.max(3,r.value/high*100)}%"></div></div><span class="rank-value">${fmt(r.value)} <small>(${r.sample})</small></span></div>`).join(''):'<div class="empty-panel">Sync game box scores to calculate the leaderboard.</div>';
}
function filterStats(p){
  const x=Object.values(p.stats||{});
  if(state.matchFilter==='strong')return x.some(s=>['strong-positive','strong-negative'].includes(s.level));
  if(state.matchFilter==='positive')return x.some(s=>['strong-positive','positive'].includes(s.level));
  if(state.matchFilter==='negative')return x.some(s=>['strong-negative','negative'].includes(s.level));
  return true;
}
function dominant(p){
  const s=Object.values(p.stats);
  const good=s.filter(x=>x.edge>9&&!x.limited).sort((a,b)=>b.edge-a.edge)[0];
  const bad=s.filter(x=>x.edge< -9&&!x.limited).sort((a,b)=>a.edge-b.edge)[0];
  if(state.matchFilter==='negative')return 'negative';
  if(state.matchFilter==='positive')return 'positive';
  return (good?.edge||0)>Math.abs(bad?.edge||0)?'positive':'negative';
}
function reasons(p,opponent){
  const stats=Object.entries(p.stats).filter(([,x])=>!x.limited&&Math.abs(x.edge)>=10).sort((a,b)=>Math.abs(b[1].edge)-Math.abs(a[1].edge));
  const notes=[];
  for(const [key,x]of stats.slice(0,2)){
    if(x.roleAllowed!==null&&x.roleN>=3){
      notes.push(`<strong>${x.edge>0?'Favourable':'Difficult'} ${LABEL[key]}:</strong> ${SAFE(opponent)} have allowed ${fmt(x.roleAllowed)} ${LABEL[key]} per game to ${SAFE(p.role)} players in ${x.roleN} outings. The model's estimate is ${x.edge>0?'+':''}${fmt(x.edge)}% relative to ${SAFE(p.name.split(' ').at(-1))}’s season baseline.`);
    }else notes.push(`<strong>${LABEL[key]} signal:</strong> ${x.edge>0?'+':''}${fmt(x.edge)}% versus season baseline, based primarily on positional history.`);
  }
  if(p.injury&&p.injury.status!=='available'&&p.injury.status!=='unknown')notes.push(`<span class="injury-flag">Player status: ${SAFE(p.injury.status)}. Actual minutes are uncertain.</span>`);
  if(p.teammateOut?.length)notes.push(`<span class="injury-flag">Teammate(s) reported out: ${SAFE(p.teammateOut.slice(0,3).join(', '))}. Model only applies changes when comparable past samples exist.</span>`);
  if(p.stats.pts?.defenseInjuryUsed>=3||p.stats.reb?.defenseInjuryUsed>=3||p.stats.ast?.defenseInjuryUsed>=3)notes.push(`<span class="injury-flag">Opponent injury adjustment includes observed defensive splits.</span>`);
  notes.push(`<span style="color:#728da3">Role: ${SAFE(p.role)} · ${p.played} qualifying player games · Projection is an estimate, not a betting line</span>`);
  return notes.map(t=>`<p>${t}</p>`).join('');
}
function playerCard(p,game){
  const opponent=p.team===game.home?game.away:game.home;
  const dir=dominant(p);
  const bright=p.major;
  const status=bright?'SEVERE EDGE':dir==='positive'?'FAVOURABLE':'UNFAVOURABLE';
  const avatar=SAFE(p.name.split(' ').map(s=>s[0]).slice(0,2).join(''));
  return `<article class="player-card ${dir}"><div class="player-head"><div class="player-portrait"><img loading="lazy" src="https://a.espncdn.com/i/headshots/nba/players/full/${encodeURIComponent(p.id)}.png" alt="" data-avatar="${avatar}"></div><div class="player-info"><strong>${SAFE(p.name)}</strong><small>${SAFE(p.team)} · ${SAFE(p.position)} / ${SAFE(p.role)} · vs ${SAFE(opponent)}</small></div><span class="severity ${dir==='negative'?'bad':''} ${!bright?'medium':''}">${status}</span></div><div class="stat-cards">${['pts','reb','ast'].map(k=>{const x=p.stats[k];const trend=x.edge>=10&&!x.limited?'up':x.edge<=-10&&!x.limited?'down':'flat';return `<div class="stat-card"><span>${k.toUpperCase()}</span><strong>${fmt(x.projection)}</strong><small class="${trend}">${x.limited?'LOW SAMPLE':`${x.edge>0?'+':''}${fmt(x.edge)}%`}</small><span style="margin-top:3px;letter-spacing:0;font-size:9px">Base ${fmt(x.base)}</span></div>`;}).join('')}</div><div class="card-notes">${reasons(p,opponent)}</div></article>`;
}
function renderMatchups(){
  const d=state.data;if(!d)return;
  const sel=$('game-filter'); const old=state.gameFilter;
  sel.innerHTML='<option value="ALL">All matchups</option>'+d.matches.map(m=>`<option value="${SAFE(m.id)}">${SAFE(m.away)} @ ${SAFE(m.home)}</option>`).join('');
  sel.value= d.matches.some(x=>x.id===old)?old:'ALL';state.gameFilter=sel.value;
  const visible=d.matches.filter(x=>state.gameFilter==='ALL'||x.id===state.gameFilter).map(g=>({...g,players:g.players.filter(filterStats)}));
  const html=visible.map(g=>{
    const players=g.players;
    const gTitle=`${SAFE(g.away)} <span style="color:#8299ac">@</span> ${SAFE(g.home)}`;
    return `<section class="game-group"><div class="game-title"><h3>${gTitle}</h3><span class="tiptime">${melTime(g.date)} Melbourne · ${players.length} matchups flagged</span></div>${players.length?`<div class="player-grid">${players.map(p=>playerCard(p,g)).join('')}</div>`:'<div class="empty-panel">No qualifying signals for this game with the current filters and sample-size thresholds.</div>'}</section>`;
  }).join('');
  $('matchup-content').innerHTML=!d.lastUpdated?'<div class="empty-panel"><strong>No live data imported yet</strong>Click Refresh data to download completed NBA box scores, tomorrow’s fixtures, and current injuries.<br><button id="empty-refresh">Refresh NBA data</button></div>':visible.length?html:'<div class="empty-panel"><strong>No games in the selected Melbourne day.</strong>Try refreshing the data. NBA schedules are organised by US date, but this view translates tipoff times to Melbourne.</div>';
  $('matchup-content').querySelectorAll('img[data-avatar]').forEach(img=>img.addEventListener('error',()=>{if(img.parentNode)img.parentNode.textContent=img.dataset.avatar||'?';}));
  $('empty-refresh')?.addEventListener('click',startRefresh);
}
async function loadAudit(){
  try{const r=await fetch('/api/backtest',{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);state.audit=await r.json();renderPerformance();}
  catch(e){showError('Could not load the backtesting report: '+e.message);}
}
function renderPerformance(){
  const a=state.audit;
  if(!a){$('performance-metrics').innerHTML='<p class="empty-panel">The model audit has not loaded yet.</p>';return;}
  const tested=a.status==='evaluated';
  $('performance-summary').innerHTML=`<strong>${tested?'BACKTEST COMPLETE':'INSUFFICIENT SAMPLE'}</strong><span>${Number(a.observations||0)} qualifying player-games · ${Number(a.training?.n||0)} training · ${Number(a.holdout?.n||0)} later holdout</span>`;
  const names={pts:'Points',reb:'Rebounds',ast:'Assists'};
  $('performance-metrics').innerHTML=['pts','reb','ast'].map(k=>{
    const x=a.models?.[k]||{};const h=x.holdout;const weights=x.weights||{};
    if(!h)return `<article class="performance-card"><h3>${names[k]}</h3><p>Not enough historical observations yet. The model is using conservative default weights.</p></article>`;
    const improvement=h.maeImprovementPct;
    const rate=v=>v==null?'—':`${(v*100).toFixed(1)}%`;
    return `<article class="performance-card"><h3>${names[k]}</h3><div class="performance-mae">${fmt(h.mae)} <small>mean absolute error</small></div><div class="perf-row"><span>Player baseline MAE</span><strong>${fmt(h.baselineMAE)}</strong></div><div class="perf-row"><span>Change vs baseline</span><strong class="${improvement>=0?'perf-good':'perf-bad'}">${improvement>0?'+':''}${fmt(improvement)}%</strong></div><div class="perf-row"><span>Severe signal directional hit rate</span><strong>${rate(h.strong?.rate)} (${h.strong?.n||0})</strong></div><div class="perf-row"><span>Favourable signal directional hit rate</span><strong>${rate(h.positive?.rate)} (${h.positive?.n||0})</strong></div><div class="perf-row"><span>Unfavourable signal directional hit rate</span><strong>${rate(h.negative?.rate)} (${h.negative?.n||0})</strong></div><p class="perf-hint">${x.calibrated?'Coefficients tuned on earlier training dates.':'Conservative default weights retained.'} Tested on ${h.n} later player-games.</p></article>`;
  }).join('');
  $('performance-notes').innerHTML=(a.notes||[]).map((x,i)=>`<p><b>${String(i+1).padStart(2,'0')}</b>${SAFE(x)}</p>`).join('');
}
async function recalculateAudit(){
  try{hideError();await securedPost('/api/backtest/recalculate');await loadAudit();}
  catch(e){showError('Recalculation failed: '+e.message);}
}
async function fetchData(){try{const r=await fetch('/api/dashboard',{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);state.data=await r.json();renderMeta();render();return true;}catch(e){showError('Unable to contact the dashboard server: '+e.message);return false;}}
function showError(t){$('error-banner').textContent=t;$('error-banner').classList.remove('hidden')}
function hideError(){$('error-banner').classList.add('hidden')}
async function securedPost(endpoint){
  let token=sessionStorage.getItem('nba-lab-update-token')||'';
  let r=await fetch(endpoint,{method:'POST',headers:token?{'Authorization':`Bearer ${token}`}:{}});
  if(r.status===401){
    // A protected hosted dashboard never embeds credentials in HTML or JavaScript.
    const supplied=window.prompt('Enter your website update token (ADMIN_TOKEN from Railway). It is stored only for this browser tab:');
    if(!supplied)throw Error('Update cancelled. An admin token is required.');
    token=supplied.trim();
    r=await fetch(endpoint,{method:'POST',headers:{'Authorization':`Bearer ${token}`}});
    if(r.ok)sessionStorage.setItem('nba-lab-update-token',token);
    else sessionStorage.removeItem('nba-lab-update-token');
  }
  if(!r.ok){let message=`HTTP ${r.status}`;try{message=(await r.json()).error||message}catch{}throw Error(message)}
  return r.json();
}
async function startRefresh(){
  hideError();
  try{await securedPost('/api/refresh');await pollStatus();}
  catch(e){showError('Refresh request failed: '+e.message);}
}

let ticker=null,lastDone='';
async function pollStatus(){
  try{
    const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);
    const s=await r.json();state.status=s;showStatus(s);
    if(s.running){if(!ticker)ticker=setInterval(pollStatus,1600);}
    else {if(ticker){clearInterval(ticker);ticker=null;}
      if(s.lastUpdated&&lastDone!==s.lastUpdated){lastDone=s.lastUpdated;await fetchData();if(state.page==='performance')await loadAudit();}
      if(s.error)showError(`Sync stopped: ${s.error}. Data from the previous completed sync remains available.`);
      else if(s.warnings?.length && s.lastUpdated)showError(`${s.warnings.length} source item(s) could not be imported; unmatched data was excluded, not estimated. Example: ${s.warnings[0]}. More details appear in the server terminal.`);
    }
  }catch(e){if(ticker){clearInterval(ticker);ticker=null;}showError('Could not check refresh progress: '+e.message);}
}
function showStatus(s){
  $('sync-panel').classList.toggle('hidden',!s.running);
  $('refresh-btn').disabled=!!s.running;
  $('refresh-btn').classList.toggle('loading',!!s.running);
  $('refresh-text').textContent=s.running?'Syncing data':'Refresh data';
  $('sync-title').textContent=s.phase||'Reading NBA feeds';
  $('sync-count').textContent=`${s.done||0} / ${s.total||0}`;
  $('sync-bar').style.width=`${s.total?Math.max(2,Math.min(100,s.done/s.total*100)):3}%`;
  $('sync-detail').textContent=s.phase==='Importing final player box scores'?'Completed games are being imported and saved in persistent storage.':'Updates come from ESPN; the next-day view uses Australia/Melbourne game dates.';
}
function bind(){
  document.querySelectorAll('.nav-link').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.page)));
  document.querySelectorAll('#stat-tabs button').forEach(b=>b.addEventListener('click',()=>{state.stat=b.dataset.stat;document.querySelectorAll('#stat-tabs button').forEach(x=>x.classList.toggle('active',x===b));renderDefence()}));
  document.querySelectorAll('#match-tabs button').forEach(b=>b.addEventListener('click',()=>{state.matchFilter=b.dataset.matchfilter;document.querySelectorAll('#match-tabs button').forEach(x=>x.classList.toggle('active',x===b));renderMatchups()}));
  $('team-search').addEventListener('input',renderTeams);
  $('pos-filter').addEventListener('change',e=>{state.position=e.target.value;renderDefence();});
  $('role-filter').addEventListener('change',e=>{state.role=e.target.value;renderDefence();});
  $('game-filter').addEventListener('change',e=>{state.gameFilter=e.target.value;renderMatchups();});
  $('refresh-btn').addEventListener('click',startRefresh);
  $('audit-refresh').addEventListener('click',recalculateAudit);
}
(async()=>{bind();await fetchData();await pollStatus()})();
