// backend/utils/env.js

// Worker 中没有 Node 的 process.env。vars 与 secrets 通过 fetch 的 env 参数传入。
// 同一 Worker 部署的所有请求共享相同的 vars/secrets，因此模块级缓存 env 引用是安全的。

let activeEnv = {};

export function setWorkerEnv(env) {
  activeEnv = env || {};
}

export function getEnv(name, fallback = '') {
  const value = activeEnv[name];
  if (value != null && value !== '') return value;
  return fallback == null ? '' : String(fallback);
}
