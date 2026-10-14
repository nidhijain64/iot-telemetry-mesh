// Disposable local stack. Never reads a deployed database or model credential.
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const compose = ['compose', '-p', 'telemetry-e2e', '-f', path.join(root,'compose.e2e.yaml')];
const children = [];
function run(command,args,options={}) {
  return new Promise((resolve,reject)=> {
    const child=spawn(command,args,{cwd:root,stdio:'inherit',...options});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${command} exited ${code}`)));
  });
}
async function ready(port) {
  for(let attempt=0;attempt<60;attempt++) {
    try {const response=await fetch(`http://127.0.0.1:${port}${port===15173?'/':'/health'}`);if(response.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error(`Service on ${port} did not start`);
}
async function main() {
  try {
    await run('docker',[...compose,'up','-d','--wait']);
    const env={...process.env,NODE_ENV:'test',MONGO_URI:'mongodb://127.0.0.1:27028/telemetry_e2e',REDIS_URL:'redis://127.0.0.1:16389',JWT_SECRET:crypto.randomBytes(32).toString('hex'),INTERNAL_SERVICE_KEY:crypto.randomBytes(32).toString('hex'),SSL_KEY_PATH:'',SSL_CERT_PATH:'',CORS_ORIGIN:'http://127.0.0.1:15173',GROQ_API_KEY:'test-no-model-calls',INSIGHT_POLL_INTERVAL_MS:'3600000',JWT_EXPIRY:'1h',ALERT_WEBHOOK_URL:'',RATE_LIMIT_LOGIN_MAX:'100',RATE_LIMIT_REGISTER_MAX:'100',VITE_DEMO_USERNAME:'',VITE_DEMO_PASSWORD:''};
    for(const [key,port] of Object.entries({AUTH_URL:13001,DEVICE_REGISTRY_URL:13002,INGESTION_URL:13003,ALERT_SERVICE_URL:13004,ALERT_URL:13004,INSIGHT_URL:13006}))env[key]=`http://127.0.0.1:${port}`;
    for(const [index,name] of ['auth-service','device-registry-service','data-ingestion-service','alert-rules-service','api-gateway','insight-agent'].entries())children.push(spawn(process.execPath,['src/index.js'],{cwd:path.join(root,'services',name),env:{...env,PORT:String(13001+index)},stdio:'inherit'}));
    children.push(spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','15173','--strictPort'],{cwd:path.join(root,'dashboard'),env:{...env,VITE_API_URL:env.AUTH_URL.replace('13001','13005'),VITE_MQTT_WS_URL:'ws://127.0.0.1:13003'},stdio:'inherit'}));
    await Promise.all([13001,13002,13003,13004,13005,13006,15173].map(ready));
    await run(process.execPath,[path.join(root,'dashboard/node_modules/cypress/bin/cypress'),'run','--browser','chrome'],{cwd:path.join(root,'dashboard')});
  } finally {
    for(const child of children)child.kill();
    await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve))));
    await run('docker',[...compose,'down']);
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
