import { startLocalTransport } from './local-transport.mjs';
// Stage 1 identity/catalog listener retains its original routes and contracts.
export function startLocalHttpApi({localTest,service,identity,...limits}={}) {
  if(!service || !identity)return Promise.reject(new Error('LOCAL_TEST_ONLY'));
  const empty=body=>{if(Object.keys(body).length)throw new Error('INVALID_REQUEST');};
  return startLocalTransport({localTest,...limits,routes:{
    '/v1/register':async body=>[202,await identity.register(body)],
    '/v1/login':async body=>[200,await identity.login(body)],
    '/v1/recover':async body=>[200,await identity.recover(body)],
    '/v1/logout':async(body,token)=>{empty(body);return [200,{revoked:await service.logout(token)}];},
    '/v1/logout-all':async(body,token)=>{empty(body);return [200,{revoked:await service.logoutAll(token)}];},
    '/v1/localities/suggest':async(body,token)=>[200,await service.suggestLocalities(token,body)],
    '/v1/services/search':async(body,token)=>[200,await service.search(token,body)]
  }});
}
