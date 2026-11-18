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
const EAST=new Set(['ATL','BOS','BKN','CHA','CHI','CLE','DET','IND','MIA','MIL','NYK','ORL','PHI','TOR','WAS']);
function signed(n){return `${n>0?'+':''}${fmt(n)}`;}
function renderDefence(){
  const d=state.data;if(!d)return;
  const conference=$('conference-filter').value;
  const teams=d.teams.filter(t=>conference==='ALL'||EAST.has(t.abbr)===(conference==='EAST'));
  const roles=d.roles.filter(r=>(state.position==='ALL'||r.position===state.position)&&d.teams.some(t=>(d.teamData[t.abbr]||[]).some(x=>x.role===r.role&&x.n>0)));
  const unit=LABEL[state.stat];$('heatmap-unit').textContent=`${unit.toUpperCase()} / PLAYER-GAME`;
  const scale={pts:4,reb:2,ast:1.5}[state.stat];
  const header='<thead><tr><th scope="col">POSITION / ROLE</th>'+teams.map(t=>`<th scope="col" title="${SAFE(t.name)}"><span class="heatmap-team">${SAFE(t.abbr)}</span></th>`).join('')+'</tr></thead>';
  const rows=roles.map(role=>`<tr><th scope="row"><span class="heatmap-pos">${SAFE(role.position)}</span>${SAFE(role.role)}</th>${teams.map(t=>{
    const r=d.teamData[t.abbr].find(x=>x.role===role.role),n=r?.n||0;
    const value=n&&r.league?(r.delta?.[state.stat]??r[state.stat]-r.league[state.stat]):null;
    const intensity=value===null?0:Math.min(1,Math.abs(value)/scale);
    const color=value>0?`rgba(0,190,110,${.15+.7*intensity})`:value<0?`rgba(226,25,66,${.15+.7*intensity})`:'rgba(180,148,35,.18)';
    const label=value===null?'—':signed(value);
    const tip=value===null?'No observed sample':`${t.name} / ${role.role}: ${label} ${unit}. Team ${fmt(r[state.stat])}; league ${fmt(r.league[state.stat])}; ${n} player-games across ${r.games} games.${n<5?' Small sample.':''}`;
    return `<td><button class="heatmap-cell ${n<5?'small-sample':''}" style="background:${color}" data-team="${SAFE(t.abbr)}" data-role="${SAFE(role.role)}" title="${SAFE(tip)}" aria-label="${SAFE(tip)}">${label}</button></td>`;
  }).join('')}</tr>`).join('');
  $('heatmap-table').innerHTML=header+'<tbody>'+ (rows||`<tr><td colspan="${teams.length+1}" class="empty-panel">No data for this position. Try Guards, Forwards or Centres.</td></tr>` )+'</tbody>';
  $('heatmap-table').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
    $('heatmap-table').querySelectorAll('.selected-cell').forEach(c=>c.classList.remove('selected-cell'));b.classList.add('selected-cell');$('heatmap-detail').textContent=b.title;
  }));
  $('heatmap-detail').textContent='Select any cell to inspect its averages.';
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
  const good=s.filter(x=>['positive','strong-positive'].includes(x.level)).sort((a,b)=>b.edge-a.edge)[0];
  const bad=s.filter(x=>['negative','strong-negative'].includes(x.level)).sort((a,b)=>a.edge-b.edge)[0];
  if(state.matchFilter==='negative')return 'negative';
  if(state.matchFilter==='positive')return 'positive';
  return (good?.edge||0)>Math.abs(bad?.edge||0)?'positive':'negative';
}
function reasons(p,opponent){
  const stats=Object.entries(p.stats).filter(([,x])=>['positive','negative','strong-positive','strong-negative'].includes(x.level)).sort((a,b)=>Math.abs(b[1].edge)-Math.abs(a[1].edge));
  const notes=[];const c=p.context;
  if(c)notes.push(`<strong>Estimated minutes: ${fmt(c.projectedMinutes)}</strong> · last five ${fmt(c.recentMinutes)} · season ${fmt(c.baselineMinutes)}. ${c.budgetAdjusted?'Adjusted to the team’s 240-minute budget.':''}`);
  for(const [key,x]of stats.slice(0,2)){
    notes.push(`<strong>${x.edge>0?'Favourable':'Unfavourable'} ${LABEL[key]}:</strong> ${fmt(x.projection)} projected vs ${fmt(x.base)} season average (${signed(x.delta??x.projection-x.base)}).`);
    if(x.components)notes.push(`<span class="component-breakdown">${Object.entries(x.components).map(([k,v])=>`${{minutes:'Minutes',form:'Recent rate',injury:'Injury / role',matchup:'Defence & pace'}[k]} ${signed(v)}`).join(' · ')}</span>`);
    if(x.roleAllowed!==null)notes.push(`${SAFE(opponent)} allow ${fmt(x.roleAllowed)} ${LABEL[key]} to this role vs ${fmt(x.leagueRole)} league-wide (${x.roleN} player-games). This is one input, not the whole signal.`);
  }
  for(const driver of c?.drivers||[])notes.push(`<span class="injury-flag"><strong>${SAFE(driver.name)} out:</strong> ${SAFE(driver.method)} · ${signed(driver.minuteChange)} estimated minutes${driver.method.startsWith('Observed')?` · ${driver.withGames} with / ${driver.withoutGames} without games`:'. Usage change is an assumption, not a confirmed coaching decision'}.</span>`);
  if(c&&!c.freshInjuries)notes.push('Fresh injury data unavailable: no numerical injury boost applied.');
  if(p.injury&&['questionable','probable','day-to-day'].includes(p.injury.status))notes.push(`<span class="injury-flag">Conditional on playing: ${SAFE(p.injury.status)}. Minutes are not confirmed.</span>`);
  if(p.teammateOut?.length&&!c?.drivers?.length)notes.push(`Reported out: ${SAFE(p.teammateOut.join(', '))}. No additional opportunity boost: already reflected in the recent rotation or insufficient evidence.`);
  if(Object.values(p.stats).some(x=>x.defenseInjuryUsed>=3))notes.push('Opponent injury effect uses observed positional defensive splits.');
  notes.push(`<span style="color:#91a5b8">${p.played} player-games · Estimated opportunity; not a betting probability</span>`);
  return notes.map(t=>`<p>${t}</p>`).join('');
}
function playerCard(p,game){
  const opponent=p.team===game.home?game.away:game.home;
  const dir=dominant(p);
  const bright=p.major;
  const status=(p.injury&&['questionable','day-to-day'].includes(p.injury.status)?'CONDITIONAL · ':'')+(bright?'STRONG · ':'')+(dir==='positive'?'FAVOURABLE':'UNFAVOURABLE');
  const avatar=SAFE(p.name.split(' ').map(s=>s[0]).slice(0,2).join(''));
  return `<article class="player-card ${dir}"><div class="player-head"><div class="player-portrait"><img loading="lazy" src="https://a.espncdn.com/i/headshots/nba/players/full/${encodeURIComponent(p.id)}.png" alt="" data-avatar="${avatar}"></div><div class="player-info"><strong>${SAFE(p.name)}</strong><small>${SAFE(p.team)} · ${SAFE(p.position)} / ${SAFE(p.role)} · vs ${SAFE(opponent)}</small></div><span class="severity ${dir==='negative'?'bad':''} ${!bright?'medium':''}">${status}</span></div><div class="stat-cards">${['pts','reb','ast'].map(k=>{const x=p.stats[k];const trend=x.edge>=10&&!x.limited?'up':x.edge<=-10&&!x.limited?'down':'flat';return `<div class="stat-card"><span>${k.toUpperCase()}</span><strong>${fmt(x.projection)}</strong><small class="${trend}">${x.limited?'LOW SAMPLE':`${signed(x.delta??x.projection-x.base)} vs avg`}</small><span style="margin-top:3px;letter-spacing:0;font-size:9px">Base ${fmt(x.base)}</span></div>`;}).join('')}</div><div class="card-notes">${reasons(p,opponent)}</div></article>`;
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
  $('performance-summary').innerHTML=`<p class="scenario-notice">Statistical model audit only — live minutes and injury opportunity estimates are not tested by these figures.</p><strong>${tested?'BACKTEST COMPLETE':'INSUFFICIENT SAMPLE'}</strong><span>${Number(a.observations||0)} qualifying player-games · ${Number(a.training?.n||0)} training · ${Number(a.holdout?.n||0)} later holdout</span>`;
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
  $('conference-filter').addEventListener('change',renderDefence);
  $('pos-filter').addEventListener('change',e=>{state.position=e.target.value;renderDefence();});
  $('game-filter').addEventListener('change',e=>{state.gameFilter=e.target.value;renderMatchups();});
  $('refresh-btn').addEventListener('click',startRefresh);
  $('audit-refresh').addEventListener('click',recalculateAudit);
}
(async()=>{bind();await fetchData();await pollStatus()})();
