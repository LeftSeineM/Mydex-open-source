import fs from 'node:fs';
import nodemailer from 'nodemailer';

// Credentials live in a server-private file, never in the repository or response.
export function emailSender(configFile) {
  if (!configFile) return null;
  const c=JSON.parse(fs.readFileSync(configFile,'utf8'));
  if(!c.host||!c.user||!c.password||!c.from)throw Error('Incomplete SMTP configuration');
  const port=Number(c.port||465);
  if(![465,587].includes(port))throw Error('Use SMTP TLS on port 465 or 587');
  const transport=nodemailer.createTransport({host:c.host,port,secure:port===465,requireTLS:true,auth:{user:c.user,pass:c.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{minVersion:'TLSv1.2'}});
  return async({email,code,purpose})=>{
    await transport.sendMail({from:c.from,to:email,subject:purpose==='login'?'Mydex 邮箱登录验证码':'Mydex 邮箱注册验证码',text:`你的 Mydex ${purpose==='login'?'登录':'注册'}验证码是：${code}\n\n10 分钟内有效，仅可使用一次。请勿向任何人透露验证码。如果不是你本人申请，请忽略此邮件。`});
  };
}
