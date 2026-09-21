// backend/database/database.js

/**
 * 封装 Cloudflare D1 数据库基本操作接口
 */
export function createDbAdapter(env) {
    const db = env.DB; // 对应 wrangler.json 中绑定的 "DB"

    return {
        // 查询多行数据
        async all(query, params = []) {
            const stmt = db.prepare(query).bind(...params);
            const { results } = await stmt.all();
            return results || [];
        },

        // 查询单行数据
        async get(query, params = []) {
            const stmt = db.prepare(query).bind(...params);
            return await stmt.first();
        },

        // 执行插入、更新、删除
        async run(query, params = []) {
            const stmt = db.prepare(query).bind(...params);
            return await stmt.run();
        }
    };
}