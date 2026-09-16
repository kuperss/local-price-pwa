// Password-derived KEK wraps a random per-version cost key. No password is persisted.
export const COST_FORMAT = 'split-costs-v1';
export const COST_ITERATIONS = 600000;
export const isCostField = label => /成本|cost/i.test(String(label).normalize('NFKC'));
const enc = new TextEncoder();
export const fromBase64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export function toBase64(value) {
  let result = '';
  for (const byte of new Uint8Array(value)) result += String.fromCharCode(byte);
  return btoa(result);
}
export async function passwordKey(password, salt, extractable = false) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt:fromBase64(salt), iterations:COST_ITERATIONS}, base,
    {name:'AES-GCM', length:256}, extractable, ['encrypt', 'decrypt']);
}
export async function createCostPasswordConfig(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || !password.trim()) {
    throw new Error('成本密碼請使用 12～128 個字元。');
  }
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await passwordKey(password, salt, true);
  return {salt, iterations:COST_ITERATIONS, wrappingKey:toBase64(await crypto.subtle.exportKey('raw', key))};
}
export function validCostConfig(config) {
  try { return config?.iterations === COST_ITERATIONS && fromBase64(config.salt).length === 16 && fromBase64(config.wrappingKey).length === 32; }
  catch { return false; }
}
export async function wrapCostKey(rawKey, version, config) {
  const key = await crypto.subtle.importKey('raw', fromBase64(config.wrappingKey), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:enc.encode(`cost-key:${version}:${config.revision}`)}, key, fromBase64(rawKey));
  return {wrapIv:toBase64(iv), wrappedKey:toBase64(wrapped)};
}
export async function decryptCostEnvelope(password, envelope) {
  if (!envelope?.configured) throw new Error('管理員尚未設定成本密碼，請聯絡管理員。');
  return decryptCostEnvelopeWithKey(await passwordKey(password, envelope.salt), envelope);
}
export async function decryptCostEnvelopeWithKey(wrappingKey, envelope) {
  if (!envelope?.configured) throw new Error('管理員尚未設定成本密碼，請聯絡管理員。');
  if (envelope.iterations !== COST_ITERATIONS) throw new Error('成本資料格式不支援，請更新料檔。');
  let plain;
  try {
    const rawKey = await crypto.subtle.decrypt({name:'AES-GCM', iv:fromBase64(envelope.wrapIv),
      additionalData:enc.encode(`cost-key:${envelope.version}:${envelope.revision}`)}, wrappingKey, fromBase64(envelope.wrappedKey));
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    new Uint8Array(rawKey).fill(0);
    plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:fromBase64(envelope.iv), additionalData:enc.encode(`costs:${envelope.version}`)}, key, fromBase64(envelope.cipher));
  } catch { throw new Error('密碼錯誤或成本料檔已失效，請重新輸入或更新料檔。'); }
  const rows = JSON.parse(new TextDecoder().decode(plain));
  new Uint8Array(plain).fill(0);
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row['型號'] !== 'string' || Object.keys(row).some(k => k !== '型號' && !isCostField(k)))) {
    throw new Error('成本資料格式錯誤。');
  }
  return rows;
}

// Wrong target or >3 seconds between taps resets the entire 5 → 4 → 3 sequence.
export function createCostGesture(onUnlock, now = () => Date.now()) {
  const sequence = [['pill', 5], ['logo', 4], ['pill', 3]];
  let step = 0, count = 0, last = 0;
  return key => {
    const time = now();
    if (time - last > 3000) { step = 0; count = 0; }
    last = time;
    if (sequence[step][0] !== key) { step = 0; count = 0; return; }
    if (++count === sequence[step][1]) {
      count = 0;
      if (++step === sequence.length) { step = 0; onUnlock(); }
    }
  };
}
