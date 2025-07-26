import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import axios from 'axios';
import cors from 'cors';

const app = express();
app.use(cors());
const port = 4002;

// analytics 配置
const ANALYTICS_BASE_URL = process.env.ANALYTICS_BASE_URL;
const ANALYTICS_USERNAME = process.env.ANALYTICS_USERNAME;
const ANALYTICS_PASSWORD = process.env.ANALYTICS_PASSWORD;

const WEBSITE_IDS = {
  codefe: 'cbf6350d-951c-41c6-ad0d-c96912882a84',
  hmxy: '99a4a7da-1f68-4cdb-b522-3cdabc47b520',
  poetry: '5591c5cd-9139-4779-acca-d4fef1aecf37',
};

// 缓存状态
let authToken: string | null = null;
let cache: Record<string, any> = {};
let cacheExpiresAt: Record<string, number> = {};

async function login() {
  try {
    const res = await axios.post(`${ANALYTICS_BASE_URL}/api/auth/login`, {
      username: ANALYTICS_USERNAME,
      password: ANALYTICS_PASSWORD,
    });

    if (!res.data?.token) {
      throw new Error('登录失败：未获取到 token');
    }

    authToken = res.data.token;
    console.log('[analytics] 登录成功，获取 token');
    return true;
  } catch (error) {
    console.error('[analytics] 登录失败:', (error as Error).message);
    authToken = null;
    return false;
  }
}

async function getToken() {
  if (!authToken) {
    await login();
  }
  return authToken;
}

async function getVisitorData(websiteId: string, retryCount = 1): Promise<any> {
  const now = Date.now();
  const cacheKey = websiteId;

  // 检查缓存
  if (cache[cacheKey] && now < cacheExpiresAt[cacheKey]) {
    return cache[cacheKey];
  }

  try {
    const token = await getToken();
    if (!token) {
      throw new Error('无法获取有效的认证令牌');
    }

    const url = `${ANALYTICS_BASE_URL}/api/websites/${websiteId}/stats?startAt=0&endAt=9999999999999`;
    console.log('[analytics] 获取访客数据:', url);
    const res = await axios.get(
      url,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        validateStatus: status => status < 500 // 只重试服务器错误
      }
    );

    // 处理未授权响应
    if (res.status === 401 && retryCount > 0) {
      console.log('[analytics] 认证失败，尝试重新登录...');
      authToken = null; // 清除旧 token
      return getVisitorData(websiteId, retryCount - 1);
    }

    if (res.status !== 200) {
      throw new Error(`请求失败: ${res.status} ${res.statusText}`);
    }

    // 更新缓存（30秒）
    cache[cacheKey] = res.data;
    cacheExpiresAt[cacheKey] = now + 30 * 1000;

    // console.log('[analytics] 获取访客数据成功:', res);

    return res.data;
  } catch (error) {
    console.error('[analytics] 获取访客数据失败:', (error as Error).message);
    throw error;
  }
}

app.get('/api/visitors', async (req: express.Request, res: express.Response) => {
  const { website = 'codefe' } = req.query;

  const websiteId = WEBSITE_IDS[website as keyof typeof WEBSITE_IDS];
  if (!websiteId) {
    return res.status(400).json({ error: 'Invalid website parameter' });
  }

  try {
    const data = await getVisitorData(websiteId);
    res.json(data);
  } catch (err) {
    console.error('获取访客数据出错:', (err as Error).message);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

app.listen(port, () => {
  console.log(`服务已启动：http://localhost:${port}`);
});