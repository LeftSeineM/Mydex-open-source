// Deliberately return fixed text rather than leaking raw stderr/configuration.
export function gatewayFailure(raw) {
 if(/EADDRINUSE/.test(raw))return '连接端口已被占用，请核对原连接服务';
 if(/This Router database already has an execution owner/.test(raw))return 'Router 数据库进程锁被占用，连接服务暂未启动';
 if(/Router identity changed/.test(raw))return 'Router 身份与保存的账本不一致，需要核对配置';
 if(/ERR_MODULE_NOT_FOUND|Cannot find module/.test(raw))return '连接服务文件缺失，请修复 Mydex 安装';
 if(/EACCES|EPERM/.test(raw))return '连接服务无法访问所需文件，请检查文件权限';
 return null;
}
