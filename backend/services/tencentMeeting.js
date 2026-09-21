// backend/server.js
import { createDbAdapter } from '../database/database.js';
import { handleMeetingRoutes } from '../routes/meetings.js';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 设置 CORS 跨域响应头（便于前端跨域调用）
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Content-Ty pe': 'application/json; charset=utf-8'
        };

        // 处理预检 OPTIONS 请求
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // 初始化 D1 数据库桥接
            const db = createDbAdapter(env);

            // API 路由分发
            if (path.startsWith('/api/meetings')) {
                const responseData = await handleMeetingRoutes(path, request, env, db);
                return new Response(JSON.stringify(responseData), {
                    status: 200,
                    headers: corsHeaders
                });
            }

            // 健康检查接口
            if (path === '/api/health') {
                return new Response(JSON.stringify({ status: 'ok', service: 'chicken-meeting-worker' }), {
                    status: 200,
                    headers: corsHeaders
                });
            }

            return new Response(JSON.stringify({ error: 'Not Found' }), {
                status: 404,
                headers: corsHeaders
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: corsHeaders
            });
        }
    }
};