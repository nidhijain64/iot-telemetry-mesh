// Uses synthetic demo accounts/readings only. Run after seed-demo.cjs.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mqtt = require('../dashboard/node_modules/mqtt');
const [api, broker] = process.argv.slice(2);
if (!api || !broker) throw new Error('Usage: node openshift/smoke.cjs https://API wss://MQTT');
const clients = [];
async function request(path, token, method='GET', body) {
  const res = await fetch(api + path, { method, headers: {'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})}, ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20000) });
  return {status:res.status, body:await res.json()};
}
async function login(username,password) {
  const res = await request('/api/auth/login',null,'POST',{username,password});
  assert.equal(res.status,200); return res.body.token;
}
async function provision(token,deviceId) {
  const res = await request('/api/devices',token,'POST',{deviceId,label:deviceId,type:'simulator'});
  assert.ok([201,409].includes(res.status));
  const secret = await request(`/api/devices/${deviceId}/credentials`,token,'POST',{});
  assert.equal(secret.status,201); return secret.body.secret;
}
async function connect(username,password) {
  const client = mqtt.connect(broker,{username,password,reconnectPeriod:0,connectTimeout:15000});
  clients.push(client);
  await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('error',reject);});
  return client;
}
(async()=>{
  assert.equal((await request('/api/devices')).status,401);
  const admin=await login('admin1','FleetAdmin2026');
  const username='check_'+Date.now().toString(36);
  const password=randomBytes(18).toString('hex');
  assert.equal((await request('/api/auth/register',null,'POST',{username,password})).status,201);
  const operator=await login(username,password);
  const owned='demo-'+username;
  const adminSecret=await provision(admin,'demo-admin-sensor');
  const secret=await provision(operator,owned);
  const fleet=await request('/api/devices',admin);
  assert.ok(fleet.body.some(d=>d.deviceId===owned));
  const ownFleet=await request('/api/devices',operator);
  assert.ok(ownFleet.body.every(d=>d.deviceId===owned));
  assert.equal((await request('/api/telemetry/demo-admin-sensor/history',operator)).status,404);
  const viewer=await connect('dashboard',operator);
  const received=[]; viewer.on('message',(topic,payload)=>received.push({topic,body:JSON.parse(payload)}));
  await new Promise((resolve,reject)=>viewer.subscribe('telemetry/#',err=>err?reject(err):resolve()));
  const pubAdmin=await connect('demo-admin-sensor',adminSecret);
  const pubOwn=await connect(owned,secret);
  for(const temperature of [22,24,40]) {
    for(const [client,id] of [[pubAdmin,'demo-admin-sensor'],[pubOwn,owned]]) {
      await new Promise((resolve,reject)=>client.publish('telemetry/'+id,JSON.stringify({source:'simulator',temperature,humidity:50,batteryLevel:80}),{qos:1},err=>err?reject(err):resolve()));
    }
  }
  let history;
  for(let attempt=0;attempt<20;attempt++) {
    history=await request(`/api/telemetry/${owned}/history`,operator);
    if(history.body.length>=3&&received.length>=3)break;
    await new Promise(r=>setTimeout(r,500));
  }
  assert.equal(history.status,200);assert.ok(history.body.length>=3);
  assert.ok(received.length>=3);assert.ok(received.every(r=>r.topic==='telemetry/'+owned));
  assert.ok(received.every(r=>history.body.some(h=>h.readingId===r.body.readingId)));
  const alerts=await request('/api/alerts',admin);
  assert.ok(alerts.body.some(a=>a.deviceId===owned&&a.type==='high-temperature'));
  assert.equal((await request('/api/insights',admin)).status,200);
  console.log('PASS: public API authentication, admin fleet access, operator isolation, WSS telemetry, durable history IDs, alert generation, insights endpoint');
  console.log('Synthetic demo readings are available in the administrator dashboard.');
})().catch(err=>{console.error(err.message);process.exitCode=1;}).finally(()=>{for(const c of clients)c.end(true);});
