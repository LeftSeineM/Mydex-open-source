// Server-only inference. No model credential is exposed through the gateway.
export class RouterModel {
  constructor(config,fetcher=fetch){
    const u=new URL(config.baseUrl);if(u.protocol!=='https:'||u.username||u.password)throw Error('协调模型地址必须为 HTTPS');
    this.config=config;this.fetcher=fetcher;
  }
  async turn(messages,tools){
    const c=this.config,r=await this.fetcher(c.baseUrl.replace(/\/$/,'')+'/chat/completions',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(/deepseek/i.test(this.config.model)?35000:90000),
      headers:{Authorization:'Bearer '+c.key,'Content-Type':'application/json'},
      body:JSON.stringify({model:c.model,...(/deepseek/i.test(c.model)?{max_tokens:2400,enable_thinking:false}:{reasoning_effort:c.effort||'low',max_completion_tokens:2400}),messages,...(tools?.length?{tools}:{})})
    });
    // Do not echo provider bodies: they may contain submitted context or secrets.
    if(!r.ok)throw Error('协调模型暂不可用（HTTP '+r.status+'），任务已保存，可稍后继续');
    const data=await r.json(),message=data.choices?.[0]?.message;
    if(!message||(!message.content&&!message.tool_calls?.length))throw Error('协调模型没有返回有效内容');
    return {role:'assistant',content:message.content||'',...(message.tool_calls?.length?{tool_calls:message.tool_calls.slice(0,8)}:{})};
  }
}
