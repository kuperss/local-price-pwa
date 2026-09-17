// Do not expose SQL, bindings, provider credentials or arbitrary exception text.
export function serviceError(error){
 if(error?.status)return {status:error.status,body:{error:error.message}};
 let cause=error;
 for(let depth=0;cause&&depth<5;depth++,cause=cause.cause){
  if(/exceeded D1.{0,80}daily row read limit/i.test(String(cause.message||cause))){
   return {status:503,body:{code:'D1_DAILY_READ_LIMIT',error:'雲端資料庫今日讀取額度已用完，暫時無法處理操作。額度於台灣時間每日早上 8 點重置；請重置後重新整理並確認清單狀態，勿重複送出。'}};
  }
 }
 return {status:500,body:{error:'服務暫時無法使用'}};
}
