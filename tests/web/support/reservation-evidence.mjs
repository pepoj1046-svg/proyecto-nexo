import pg from'pg';
// Independent witness: no write privileges are used, no identity/session values
// are exported, and its configuration comes only from the loopback test runner.
export async function reservationEvidence(){
 const c=JSON.parse(process.env.NEXO_WEB_AUDIT_CONFIG??'null');
 if(process.env.NEXO_WEB_TEST_LOCAL!=='1'||c?.host!=='127.0.0.1'||!/^nexo_test_[a-f0-9]+$/.test(c.database))throw Error('LOCAL_WITNESS_REQUIRED');
 const db=new pg.Client({...c,options:'-c default_transaction_read_only=on',query_timeout:5000});await db.connect();
 return{close:()=>db.end(),async snapshot(key){
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const a=(await db.query('SELECT actor_id,result FROM nexo.actions WHERE action_key=$1',[key])).rows;
   const bookings=a.length?(await db.query("SELECT id,trip_id,group_id,seats,from_stop,to_stop,price_bob,fare_version,status FROM nexo.bookings WHERE passenger_id=$1 AND source='APP' ORDER BY id",[a[0].actor_id])).rows:[];
   const ids=bookings.map(b=>b.id),trips=bookings.map(b=>b.trip_id);
   return{actions:a.map(x=>x.result),bookings,
    audits:(await db.query('SELECT action,entity_id FROM nexo.audit_events WHERE entity_id=ANY($1::uuid[]) ORDER BY id',[ids])).rows,
    movements:(await db.query('SELECT booking_id,kind FROM nexo.effective_movements WHERE booking_id=ANY($1::uuid[]) ORDER BY fact_key',[ids])).rows,
    trips:(await db.query('SELECT id,status,current_stop,departed_at FROM nexo.trips WHERE id=ANY($1::uuid[]) ORDER BY id',[trips])).rows,
    overCapacity:(await db.query('SELECT t.id,s.stop_index FROM nexo.trips t JOIN nexo.stops s ON s.route_id=t.route_id JOIN nexo.bookings b ON b.trip_id=t.id AND b.from_stop<=s.stop_index AND b.to_stop>s.stop_index AND nexo.live(b) GROUP BY t.id,s.stop_index HAVING sum(b.seats)>6')).rows};
  }finally{await db.query('ROLLBACK');}
 }};
}
