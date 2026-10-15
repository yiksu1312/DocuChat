export class AppError extends Error {
 constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function publicError(error) {
 if (error instanceof AppError) return error;
 if (error.name === 'TimeoutError' || /timeout/i.test(error.name || '')) return new AppError(504, 'MODEL_TIMEOUT', '模型处理超时，请重试。');
 if (/abort/i.test(error.name || '')) return new AppError(499, 'CANCELLED', '已停止生成。');
 if ([401,403].includes(error.status)) return new AppError(502, 'MODEL_AUTH_FAILED', '模型认证失败，请检查后端密钥和权限。');
 if (error.status === 429) return new AppError(503, 'MODEL_RATE_LIMIT', '模型额度不足或请求频繁，请稍后重试。');
 return new AppError(502, 'MODEL_FAILED', '模型服务调用失败，请检查后端网络和模型配置。');
}
export async function bounded(work, signal) {
 signal.throwIfAborted();
 let handler;
 try {
  return await Promise.race([work(), new Promise((_,reject) => {
   handler=()=>reject(signal.reason); signal.addEventListener('abort', handler, {once:true});
   if(signal.aborted) handler();
  })]);
 } finally { if(handler)signal.removeEventListener('abort',handler); }
}
