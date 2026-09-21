// backend/utils/http.js

/** 构造 JSON 响应 */
export function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }
  });
}

export function responseOk(data, message = '', extraHeaders = {}) {
  return json(200, { success: true, data, message }, extraHeaders);
}

export function responseFail(status, message, data = null, extraHeaders = {}) {
  return json(status, { success: false, data, message }, extraHeaders);
}

/** 安全解析请求 JSON body，失败时返回空对象 */
export async function readJsonBody(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch (error) {
    return {};
  }
}
