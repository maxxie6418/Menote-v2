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
return {w,h,ch,stride,out,px:(x,y)=>{const i=y*stride+x*ch;return [out[i],out[i+1],out[i+2]];}};}
const im=decode('draft/design-full.png');
console.log('整页', im.w+'x'+im.h);
// 深色 demo 底色 #1A1C1E = (26,28,30)
let firstDark=-1,lastDark=-1,minX=1e9,maxX=-1;
for(let y=0;y<im.h;y+=2){for(let x=0;x<im.w;x+=3){const c=im.px(x,y);
 if(Math.abs(c[0]-26)<4&&Math.abs(c[1]-28)<4&&Math.abs(c[2]-30)<4){
  if(firstDark<0)firstDark=y;lastDark=y;if(x<minX)minX=x;if(x>maxX)maxX=x;}}}
console.log('深色 demo 区域 y:',firstDark,'..',lastDark,' x:',minX,'..',maxX);
