// Reasons explain the existing attention filter; individual warehouse/incoming values are NOT triggers.
export function attentionReasons(row){
 const reasons=[];
 if(row.missing)reasons.push('來源查無產品資料');
 if(row.issue)reasons.push('售轉關係需確認：'+row.issue);
 const replacements=row.replacements||[];
 if(row.available!=null&&row.available<=0&&replacements.length)
  reasons.push(row.available===0?'原型號實際可用量為 0，已有替代型號':'原型號實際可用量為負，已有替代型號');
 const unlisted=replacements.filter(r=>!['published','pending_add'].includes(r.state)).map(r=>r.sku);
 if(unlisted.length)reasons.push('替代型號未納入啟用清單：'+unlisted.join('、'));
 return reasons;
}
