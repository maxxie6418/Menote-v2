const fs=require('fs'),zlib=require('zlib');
function decode(f){const buf=fs.readFileSync(f);let p=8,w,h,ct,idat=[];
while(p<buf.length){const len=buf.readUInt32BE(p);const type=buf.toString('ascii',p+4,p+8);
 if(type==='IHDR'){w=buf.readUInt32BE(p+8);h=buf.readUInt32BE(p+12);ct=buf[p+17];}
 if(type==='IDAT')idat.push(buf.slice(p+8,p+8+len));p+=12+len;}
const raw=zlib.inflateSync(Buffer.concat(idat));const ch=ct===6?4:ct===2?3:1;const stride=w*ch;
const out=Buffer.alloc(h*stride);let pos=0;
for(let y=0;y<h;y++){const fl=raw[pos++];const line=raw.slice(pos,pos+stride);pos+=stride;
 for(let x=0;x<stride;x++){const a=x>=ch?out[y*stride+x-ch]:0;const b=y>0?out[(y-1)*stride+x]:0;const c=(x>=ch&&y>0)?out[(y-1)*stride+x-ch]:0;
  let v=line[x];if(fl===1)v+=a;else if(fl===2)v+=b;else if(fl===3)v+=(a+b)>>1;
  else if(fl===4){const pa=Math.abs(b-c),pb=Math.abs(a-c),pc=Math.abs(a+b-2*c);v+=(pa<=pb&&pa<=pc)?a:(pb<=pc?b:c);}
  out[y*stride+x]=v&255;}}
return {w,h,ch,stride,out};}
function encode(w,h,ch,px){ // 最小 PNG 编码（RGBA/RGB，无过滤）
 const stride=w*ch;const raw=Buffer.alloc(h*(stride+1));
 for(let y=0;y<h;y++){raw[y*(stride+1)]=0;px.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);}
 const idat=zlib.deflateSync(raw);
 const chunks=[];
 function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
  const td=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td)>>>0);return Buffer.concat([len,td,crc]);}
 let tbl=null;
 function crc32(buf){if(!tbl){tbl=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;tbl[n]=c>>>0;}}
  let c=0xFFFFFFFF;for(let i=0;i<buf.length;i++)c=tbl[(c^buf[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=ch===4?6:2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',idat),chunk('IEND',Buffer.alloc(0))]);}
const [,,src,dst,X,Y,W,H]=process.argv;
const im=decode(src);const x0=+X,y0=+Y,cw=+W,chh=+H;
const outCh=3;const sub=Buffer.alloc(cw*chh*outCh);
for(let y=0;y<chh;y++)for(let x=0;x<cw;x++){const si=((y0+y)*im.stride)+((x0+x)*im.ch);const di=(y*cw+x)*outCh;
 sub[di]=im.out[si];sub[di+1]=im.out[si+1];sub[di+2]=im.out[si+2];}
fs.writeFileSync(dst,encode(cw,chh,outCh,sub));
console.log('已裁剪',dst,cw+'x'+chh);
