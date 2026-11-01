const http=require('http'),fs=require('fs');
const port=process.argv[2],needle=process.argv[3],sel=process.argv[4],out=process.argv[5];
const get=(p)=>new Promise((res,rej)=>http.get({host:'127.0.0.1',port:port,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));
(async()=>{
  const tabs=await get('/json/list');
  const page=tabs.find(t=>t.type==='page'&&t.url.includes(needle));
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0;const pend=new Map();
  const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);
  await send('Runtime.enable');
  await new Promise(r=>setTimeout(r,1800));
  const ev=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});
    if(r.exceptionDetails)return 'ERR';return r.result&&r.result.value;};
  const b=await ev("(()=>{const e=document.querySelector("+JSON.stringify(sel)+");if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y+scrollY),width:Math.round(r.width),height:Math.round(r.height)};})()");
  if(!b||typeof b!=='object'){console.error('未找到',sel);process.exit(1);}
  console.log('box',JSON.stringify(b));
  const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:b.x,y:b.y,width:b.width,height:b.height,scale:2},captureBeyondViewport:true,fromSurface:true});
  fs.writeFileSync(out,Buffer.from(shot.data,'base64'));
  console.log('saved',out);
  ws.close();process.exit(0);
})();
