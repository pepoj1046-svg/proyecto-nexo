import { request } from 'node:http';
export function postJson(base,path,body={},headers={},options={}) {
  const payload=options.raw ?? JSON.stringify(body);
  return new Promise((resolve,reject)=>{
    const req=request(base+path,{method:options.method ?? 'POST',agent:false,
      headers:{'Content-Type':'application/json','X-Nexo-Local-Test':'1',
        ...(options.chunked?{'Transfer-Encoding':'chunked'}:{'Content-Length':Buffer.byteLength(payload)}),...headers}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('error',reject);
      res.on('end',()=>{try {const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,
        body:text?JSON.parse(text):null});}catch(e){reject(e);}});
    });
    req.on('error',reject);req.end(payload);
  });
}
