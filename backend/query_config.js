require('dotenv').config();
const db = require('./db');
(async()=>{
  const {rows} = await db.query("SELECT config_key, value FROM system_config WHERE config_key IN ('ai_provider','openai_model','deepseek_model','qwen_model','claude_model','zhipu_model','openai_base_url')");
  rows.forEach(r=>console.log(r.config_key,'=',r.value||'(未设置)'));
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
