export function stockStatus(row){
 if(row.missing)return {tone:'unknown',label:'查無來源'};
 if(row.available==null||!Number.isFinite(row.available))return {tone:'unknown',label:'庫存未知'};
 const count=row.available.toLocaleString('zh-TW');
 return {tone:row.available>0?'in-stock':'out-stock',label:`${row.available>0?'有貨':row.available===0?'無貨':'無可用量'} · ${count}`};
}
export const replacementCodes=row=>[...new Set([row.transfer,...JSON.parse(row.targets||'[]')].filter(Boolean))];
