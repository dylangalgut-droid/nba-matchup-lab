'use strict';
// Durable cloud storage: one JSONB document for the ESPN cache and one for the audited model.
// The schema can be migrated to per-game tables when traffic or data volume warrants it.
const fs=require('node:fs');
const path=require('node:path');
const ROOT=__dirname;
const DATA_DIR=process.env.DATA_DIR||path.join(ROOT,'.data');
let pool=null;
const mode=process.env.DATABASE_URL?'postgres':(process.env.DATA_DIR?'volume':'local');
function file(name){return path.join(DATA_DIR,name);}
function localRead(name,defaultValue){try{return JSON.parse(fs.readFileSync(file(name),'utf8'));}catch{return defaultValue;}}
function localWrite(name,data){fs.mkdirSync(DATA_DIR,{recursive:true});const dest=file(name);fs.writeFileSync(dest+'.tmp',JSON.stringify(data));fs.renameSync(dest+'.tmp',dest);}
async function start(){
  if(mode!=='postgres'){
    if(process.env.RAILWAY_ENVIRONMENT && mode!=='volume')throw Error('Cloud persistence missing: configure DATABASE_URL (PostgreSQL) or a Railway volume using DATA_DIR. Refusing ephemeral storage.');
    return {cache:localRead('cache.json',null),audit:localRead('backtest.json',null)};
  }
  // pg is needed only on a PostgreSQL-enabled cloud deployment.
  const {Pool}=require('pg');
  pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:12000,idleTimeoutMillis:30000});
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS nba_app_state (key TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())');
    const res=await pool.query('SELECT key,payload FROM nba_app_state WHERE key = ANY($1::text[])',[['cache','audit']]);
    const entries=Object.fromEntries(res.rows.map(x=>[x.key,x.payload]));
    return {cache:entries.cache||null,audit:entries.audit||null};
  } catch(error) {
    const failedPool=pool;pool=null;
    await failedPool.end().catch(()=>{});
    throw error;
  }
}
async function save(cache,audit){
  if(mode!=='postgres'){localWrite('cache.json',cache);if(audit)localWrite('backtest.json',audit);return;}
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    for(const [key,data] of [['cache',cache],['audit',audit]]){
      if(!data)continue;
      await client.query('INSERT INTO nba_app_state (key,payload,updated_at) VALUES ($1,$2::jsonb,NOW()) ON CONFLICT (key) DO UPDATE SET payload=EXCLUDED.payload, updated_at=NOW()',[key,JSON.stringify(data)]);
    }
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function close(){await pool?.end();}
module.exports={start,save,close,mode};
