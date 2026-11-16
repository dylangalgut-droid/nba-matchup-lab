'use strict';
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = path.resolve(__dirname, '../data');
delete process.env.DATABASE_URL;
const app = require('../server');
(async () => {
  await app.initialize();
  if (!process.argv.includes('--cached')) await app.refresh();
  const {dashboard, audit, status} = app.snapshot();
  if (status.error) throw Error(status.error);
  if (!dashboard.lastUpdated || !status.cacheGames) throw Error('No verified NBA box scores available; preserving previous deployment.');
  const out = path.resolve(__dirname, '../dist');
  fs.rmSync(out, {recursive:true, force:true});
  fs.cpSync(path.resolve(__dirname, '../public'), out, {recursive:true});
  fs.mkdirSync(path.join(out, 'data'), {recursive:true});
  for (const [name, value] of Object.entries({dashboard, backtest:audit, status})) {
    fs.writeFileSync(path.join(out, 'data', name+'.json'), JSON.stringify(value));
  }
  let html=fs.readFileSync(path.join(out,'index.html'),'utf8');
  html=html.replace('href="/style.css"','href="./style.css"').replace('src="/app.js"','src="./app.js"').replace('href="/"','href="./"');
  html=html.replace('Recalculate backtest','Reload backtest').replace('Refresh data</span>','Reload latest data</span>');
  html=html.replace('</main>', '<p style="padding:16px 28px;color:#94a3b8;font-size:12px">Free edition · NBA data updates twice daily. Reload displays the latest published data. Data source: ESPN; availability is not guaranteed.</p></main>');
  fs.writeFileSync(path.join(out,'index.html'),html);
  let js=fs.readFileSync(path.join(out,'app.js'),'utf8');
  js=js.replaceAll("'/api/backtest'", "'./data/backtest.json'").replaceAll("'/api/dashboard'", "'./data/dashboard.json'").replaceAll("'/api/status'", "'./data/status.json'");
  js=js.replace(/async function recalculateAudit\(\)\{[\s\S]*?\n\}/, 'async function recalculateAudit(){ hideError(); await loadAudit(); }');
  js=js.replace(/async function securedPost\(endpoint\)\{[\s\S]*?\n\}/, '');
  js=js.replace(/async function startRefresh\(\)\{[\s\S]*?\n\}/, 'async function startRefresh(){ hideError(); await fetchData(); await loadAudit(); await pollStatus(); }');
  js=js.replace("'Refresh data';", "'Reload latest data';");
  js=js.replace('Click Refresh data to download completed NBA box scores, tomorrow’s fixtures, and current injuries.', 'The first scheduled NBA import has not been published yet.');
  js=js.replace('More details appear in the server terminal.', 'Details are recorded in the GitHub update run.');
  // Avoid presenting yesterday’s schedule as tomorrow’s when an update is overdue.
  js=js.replace('state.data=await r.json();renderMeta();render();', `state.data=await r.json();renderMeta();render();if(Date.now()-Date.parse(state.data.lastUpdated)>18*3600000)showError('The latest NBA update is more than 18 hours old. Check the displayed matchup date before using these ratings.');`);
  fs.writeFileSync(path.join(out,'app.js'),js);
  const version=require('node:crypto').createHash('sha256').update(js).digest('hex').slice(0,12);
  fs.writeFileSync(path.join(out,'index.html'),html.replace('./app.js', './app.js?v='+version).replace('./style.css','./style.css?v='+version));
  fs.writeFileSync(path.join(out,'.nojekyll'),'');
  console.log(JSON.stringify({lastUpdated:dashboard.lastUpdated, games:status.cacheGames, coverage:dashboard.coverage, targetDate:dashboard.targetDate}));
})().catch(e=>{console.error(e);process.exitCode=1;});
