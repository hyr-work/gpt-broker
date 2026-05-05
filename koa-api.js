import 'dotenv/config';
import Koa from 'koa';
import cors from '@koa/cors';
import bodyParser from 'koa-bodyparser';
// import redis from 'redis';

import { router } from './src/routes.js';
import { updateMetrics } from './src/middleware.js';

// Create Redis connection
// const client = redis.createClient({ url: process.env.REDIS_URL });
// client.on('error', err => {console.error('Redis Client Error', err); });
// (async () => {
//   try {
//     await client.connect();
//     console.log(' - 🔌 Redis connected');
//   } catch (err) {
//     console.error(' - ‼️ Redis connect failed', err);
//   }
// })();

const app = new Koa();

// app.context.redis = client;

// CORS allowlist. Source from ALLOWED_ORIGINS env (comma-separated).
// Defaults cover the Hyr production hostnames + local dev. NEVER call
// `cors()` with no options — that reflects any Origin and, combined
// with credentialed callers, exposes every authenticated route.
const ALLOWED_ORIGINS = (
	process.env.ALLOWED_ORIGINS ||
	[
		'https://candidate.hyr.works',
		'https://hyr-api.hyr.works',
		'https://interviewer.hyr.works',
		'https://app.hyr.works',
		'https://admin.hyr.works',
		'http://localhost:3000',
		'http://localhost:4000',
		'http://localhost:8000',
	].join(',')
).split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
	origin: (ctx) => {
		const requestOrigin = ctx.get('Origin');
		return ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : '';
	},
	credentials: true,
	allowHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
	allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(bodyParser());
app.use(updateMetrics)

// Routes
app.use(router.routes())
app.use(router.allowedMethods())

// Error handling for non-existent endpoints
app.use(async (ctx) => {
	console.log(' - 📭 user requested non-existent endpoint')
    ctx.status = 404;
    ctx.body = { error: 'Endpoint not found' };
});

const PORT = 8011;
app.listen(PORT, () => {
	console.log(` - 💼 GPT Broker running on port ${PORT}`)
});

// Close Redis connection when stopping the server
process.on('SIGINT', async () => {
    // await app.context.redis.quit();
    console.log(' - 🚪 GPT Broker stopped')
    process.exit(0);
});
