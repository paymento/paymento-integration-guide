// Test harness for references/nodejs.md. check-nodejs-reference.ts inserts the reference's code
// blocks at the SNIPPETS marker; the stubs below stand in for the merchant's database and Paymento's API.
import crypto from "crypto";
import assert from "assert";
declare namespace express { type RequestHandler = any }
process.env.PAYMENTO_IPN_SECRET="my-secret"; process.env.PAYMENTO_API_BASE="https://x"; process.env.PAYMENTO_API_KEY="k";
const applied:any[]=[]; let failApply=false, failSave=false;
const locks=new Map<string,Promise<any>>(); let useLock=true;
const tokenToOrder=new Map<string,string>(); const orderStatus=new Map<string,number>();
const Orders={ async applyPaymentoStatus(id:string,s:number){ if(failApply) throw new Error("db down"); applied.push([id,s]); orderStatus.set(id,s); },
  async savePaymentoToken(orderId:string, token:string){ tokenToOrder.set(token, orderId); if(!orderStatus.has(orderId)) orderStatus.set(orderId, 0); },
  async findByPaymentoToken(token:string){ const id=tokenToOrder.get(token); return id===undefined ? null : { paymentoStatus: orderStatus.get(id)! }; },
  async withPaymentoLock(key:string, fn:()=>Promise<void>){
    if(!useLock) return fn();
    const prev=locks.get(key)??Promise.resolve(); const run=prev.then(fn,fn); locks.set(key, run.catch(()=>{})); return run; } };
const rows:any[]=[];
const PaymentoInbox={
  async save(token:string){ if(failSave) throw new Error("db down"); rows.push({id:String(rows.length+1), token, done:false}); return String(rows.length); },
  async markProcessed(id:string){ rows.find(r=>r.id===id).done=true; },
  async pending(){ return rows.filter(r=>!r.done).map(r=>({id:r.id, token:r.token})); } };
const _err=console.error; console.error=()=>{};
let nextResponse:any;
/*@SNIPPETS@*/
(globalThis as any).fetch = async ()=>({ ok:true, json: async()=>nextResponse, text: async()=>"" });

const BODY=Buffer.from(`{"Token":"d1179e54e58d4e51a285a5c659a2b7ef","PaymentId":"20016","OrderId":"etp-3900","OrderStatus":7,"AdditionalData":[]}`); // Expected signature computed independently with Python hmac (same algorithm as Paymento's server).
const SIG="6B1C96438B9C3D0994568C3079FD0595AB43A15FF304B1695CD4C5467587006E";
// signature
assert.equal(isValidIpnSignature(BODY, SIG), true);
assert.equal(isValidIpnSignature(BODY, SIG.toLowerCase()), true);
assert.equal(isValidIpnSignature(BODY, undefined), false);
assert.equal(isValidIpnSignature(BODY, "AB"), false);
assert.equal(isValidIpnSignature({}, SIG), false);
assert.equal(isValidIpnSignature(Buffer.from(BODY.toString().replace("7","8")), SIG), false);
// handler
const run = async (body:any, sig?:string)=>{ let status=0, err:any; await ipnHandler({body, get:()=>sig}, {sendStatus:(s:number)=>{status=s;}}, (e:any)=>{err=e;}); return {status, err}; };
assert.equal((await run(BODY, undefined)).status, 401); assert.equal(rows.length,0);
assert.equal((await run(BODY, "00")).status, 401);
// cannot store -> error to Express (5xx), verify never called
failSave=true; nextResponse=undefined; let r=await run(BODY, SIG); assert.ok(r.err); assert.equal(r.status,0); failSave=false;
// happy path
nextResponse={success:true,message:"",body:{token:"t",orderId:"etp-3900",orderStatus:8,additionalData:[]}};
r=await run(BODY, SIG); assert.equal(r.status,200); assert.deepEqual(applied,[["etp-3900",8]]); assert.equal((await PaymentoInbox.pending()).length,0);
// order update fails after verify approved -> still 200, row pending, retry job fulfils
failApply=true; r=await run(BODY, SIG); assert.equal(r.status,200); assert.equal((await PaymentoInbox.pending()).length,1); assert.equal(applied.length,1);
failApply=false; await retryPendingPaymentoCallbacks(); assert.equal((await PaymentoInbox.pending()).length,0); assert.deepEqual(applied[1],["etp-3900",8]);
// invalid token -> stored, stays pending (alerting covers it), no state change
nextResponse={success:false,message:"Invalid Token",body:{token:"",orderId:"",orderStatus:0,additionalData:[]}};
r=await run(BODY, SIG); assert.equal(r.status,200); assert.equal(applied.length,2); assert.equal((await PaymentoInbox.pending()).length,1);
nextResponse={success:false,message:"",body:{token:"t",orderId:"etp-3900",orderStatus:3,additionalData:[]}};
assert.equal((await paymento.verify("t")).orderStatus, 3);
// race: slow verify reads WaitingToConfirm, then the order becomes Approve and a fast verify reads that
const race=async()=>{
  let serverStatus=3; let call=0;
  (globalThis as any).fetch=async()=>{ const status=serverStatus; const slow=++call===1;
    if(slow) await new Promise(r=>setTimeout(r,30));
    return { ok:true, text:async()=>"", json:async()=>({success:status===8,message:"",body:{token:"t",orderId:"race",orderStatus:status,additionalData:[]}}) }; };
  applied.length=0; rows.push({id:"ra",token:"t",done:false},{id:"rb",token:"t",done:false});
  const a=processPaymentoCallback("ra","t"); await new Promise(r=>setTimeout(r,5)); serverStatus=8;
  const b=processPaymentoCallback("rb","t"); await Promise.all([a,b]);
  return applied[applied.length-1][1];
};
useLock=false; assert.equal(await race(), 3, "race reproduces without the lock");
useLock=true;  assert.equal(await race(), 8, "lock keeps the newest status");
(globalThis as any).fetch = async ()=>({ ok:true, json: async()=>nextResponse, text: async()=>"" });
// request
nextResponse={success:false,message:"Please set amount",body:null};
await assert.rejects(paymento.request({}), /PAYMENTO_REQUEST_FAILED: Please set amount/);
nextResponse={success:true,message:"",body:" 3256e147c6fe4d36a9341a5112ed2214"};
assert.equal(await createGatewayUrl({orderId:"1",amount:"10",currency:"USD"}), "https://app.paymento.io/gateway?token=3256e147c6fe4d36a9341a5112ed2214");
assert.equal(tokenToOrder.get("3256e147c6fe4d36a9341a5112ed2214"), "1", "createGatewayUrl saves the token");
// return page
let verifyCalls=0;
(globalThis as any).fetch = async ()=>{ verifyCalls++; return { ok:true, text:async()=>"", json:async()=>nextResponse }; };
const rowsBefore=rows.length;
assert.equal(await paymentoReturnStatus("crafted-token"), null); assert.equal(rows.length, rowsBefore, "unknown token stores nothing"); assert.equal(verifyCalls, 0);
// known token, IPN lost: the return page runs the stored, locked flow and fulfils
nextResponse={success:true,message:"",body:{token:"3256e147c6fe4d36a9341a5112ed2214",orderId:"1",orderStatus:8,additionalData:[]}};
assert.equal(await paymentoReturnStatus("3256e147c6fe4d36a9341a5112ed2214"), 8); assert.equal(verifyCalls, 1);
assert.equal(rows.at(-1).token, "3256e147c6fe4d36a9341a5112ed2214"); assert.equal(rows.at(-1).done, true); assert.deepEqual(applied.at(-1), ["1", 8]);
// final order: no verify, no row
const rowsFinal=rows.length; assert.equal(await paymentoReturnStatus("3256e147c6fe4d36a9341a5112ed2214"), 8); assert.equal(verifyCalls, 1); assert.equal(rows.length, rowsFinal);
// processing fails: row stays pending for the retry job, page shows the stored status
await Orders.savePaymentoToken("2","tok-2"); failApply=true;
nextResponse={success:true,message:"",body:{token:"tok-2",orderId:"2",orderStatus:8,additionalData:[]}};
assert.equal(await paymentoReturnStatus("tok-2"), 0); assert.equal(rows.at(-1).done, false); failApply=false;
console.log("nodejs reference: all checks passed");
