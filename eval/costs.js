// Standard API list prices, USD per million tokens, checked 2026-10-18.
// https://developers.openai.com/api/docs/models/gpt-4.1-mini
// https://developers.openai.com/api/docs/models/text-embedding-3-small
export const prices = {input:0.40,cachedInput:0.10,output:1.60,embedding:0.02};
export function chatCost(usage) {
  if (!usage || !Number.isFinite(usage.inputTokens) || !Number.isFinite(usage.outputTokens)) return null;
  const cached=Math.max(0,Math.min(usage.inputTokens,usage.cachedInputTokens||0));
  return ((usage.inputTokens-cached)*prices.input+cached*prices.cachedInput+usage.outputTokens*prices.output)/1e6;
}
export function embeddingCost(tokens) {return Number.isFinite(tokens)?tokens*prices.embedding/1e6:null;}
export function createBudget(limit=1) {
  if (!Number.isFinite(limit) || limit<=0 || limit>1) throw new Error('Budget must be between zero and one USD.');
  let spent=0;
  return {
    get committedUsd(){return spent;},
    reserve(upperBound){
      if (!Number.isFinite(upperBound) || upperBound<0 || spent+upperBound>limit) throw new Error('EVALUATION_BUDGET_EXCEEDED');
      spent+=upperBound;let settled=false;
      return actual=>{
        if(settled)throw new Error('Budget reservation already settled');settled=true;
        // Missing usage retains the reservation; it is never treated as a free call.
        if(actual!==null){if(!Number.isFinite(actual)||actual<0)throw new Error('Invalid cost');spent+=actual-upperBound;}
      };
    },
  };
}
